"use client"

import { useEffect, useRef, useState } from "react"

type Row = {
  id: string
  at: string
  outcome: string
  summary: string
  requestedBy: string
  kind: string
  detail: string | null
}
type Msg = { who: "you" | "bot" | "sys"; text: string; confirm?: string }

const SUGGESTIONS = [
  "what's my balance?",
  "pay 500 sats to gm@getalby.com for coffee",
  "send 20000 sats to friend@walletofsatoshi.com",
  "pay 60000 sats to gm@getalby.com",
  "get me a $10 amazon gift card",
  "buy $25 of bitcoin every friday",
  "which churches can I give to?",
  "tithe 2000 sats to grace-fellowship",
  "give 10000 sats to ortiz-family every month",
  "fetch https://api.example/answer up to 50 sats",
  "sweep everything above 200000 sats to cold storage bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4 max 500000",
]

export function DemoChat() {
  const [state, setState] = useState<string | null>(null)
  const [model, setModel] = useState<string>("")
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [ledger, setLedger] = useState<Row[]>([])
  const [wallet, setWallet] = useState<{ sats: string; onchainSats: string } | null>(null)
  const [policy, setPolicy] = useState<{
    dailyCapSats: string
    perActionCapSats: string
    confirmAboveSats: string
  } | null>(null)
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch("/api/demo")
      .then((r) => r.json())
      .then((d) => {
        setState(d.state)
        setWallet(d.wallet)
        setModel(d.model)
        setMsgs([
          {
            who: "sys",
            text: `Sandbox: fake sats, real rules. Wallet 250,000 sats · on-chain 1,200,000 sats · daily cap 100,000 · ask above 5,000 · cold storage registered · giving directory loaded. Model: ${d.model === "scripted" ? "scripted (no API key on this server)" : d.model}.`,
          },
        ])
      })
      .catch(() => setMsgs([{ who: "sys", text: "The sandbox could not start. Reload the page." }]))
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on every new message
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" })
  }, [msgs])

  async function send(text: string) {
    const t = text.trim()
    if (!t || busy) return
    setBusy(true)
    setInput("")
    setMsgs((m) => [...m, { who: "you", text: t }])
    try {
      const res = await fetch("/api/demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state, text: t }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? "error")
      setState(d.state)
      setLedger(d.ledger)
      setWallet(d.wallet)
      setPolicy(d.policy)
      setModel(d.model)
      setMsgs((m) => [
        ...m,
        ...(d.note && !m.some((x) => x.text === d.note)
          ? [{ who: "sys" as const, text: d.note as string }]
          : []),
        { who: "bot", text: d.reply, confirm: d.pending?.actionHash ?? undefined },
        ...(d.deliveries as string[]).map((x) => ({ who: "bot" as const, text: x })),
      ])
    } catch (err) {
      setMsgs((m) => [...m, { who: "sys", text: (err as Error).message }])
    } finally {
      setBusy(false)
    }
  }

  const fmt = (s: string | undefined) => (s ? Number(s).toLocaleString("en-US") : "—")

  return (
    <div className="demo">
      <section className="demo__chat" aria-label="Chat">
        <div className="demo__log">
          {msgs.map((m, i) => (
            <div key={`${i}-${m.who}`} className={`demo__msg is-${m.who}`}>
              <span className="demo__who">
                {m.who === "you" ? "you" : m.who === "bot" ? "agentic bitcoin" : "sandbox"}
              </span>
              <p>{m.text}</p>
              {m.confirm && i === msgs.length - 1 ? (
                <div className="demo__confirm">
                  <button type="button" className="cta" onClick={() => send("yes")} disabled={busy}>
                    Confirm
                  </button>
                  <button
                    type="button"
                    className="demo__cancel"
                    onClick={() => send("no")}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                </div>
              ) : null}
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <form
          className="demo__input"
          onSubmit={(e) => {
            e.preventDefault()
            void send(input)
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Text it like a person…"
            aria-label="Message"
            disabled={busy || !state}
          />
          <button type="submit" className="cta" disabled={busy || !state}>
            Send
          </button>
        </form>
        <div className="demo__suggest">
          {SUGGESTIONS.map((s) => (
            <button type="button" key={s} onClick={() => send(s)} disabled={busy || !state}>
              {s.length > 48 ? `${s.slice(0, 46)}…` : s}
            </button>
          ))}
        </div>
      </section>
      <aside className="demo__side">
        <h2>Wallet</h2>
        <p className="demo__kv">
          <span>Lightning</span>
          <strong>{fmt(wallet?.sats)} sats</strong>
        </p>
        <p className="demo__kv">
          <span>On-chain</span>
          <strong>{fmt(wallet?.onchainSats)} sats</strong>
        </p>
        <h2>Limits</h2>
        <p className="demo__kv">
          <span>Daily cap</span>
          <strong>{fmt(policy?.dailyCapSats ?? "100000")} sats</strong>
        </p>
        <p className="demo__kv">
          <span>Per action</span>
          <strong>{fmt(policy?.perActionCapSats ?? "50000")} sats</strong>
        </p>
        <p className="demo__kv">
          <span>Ask above</span>
          <strong>{fmt(policy?.confirmAboveSats ?? "5000")} sats</strong>
        </p>
        <h2>Ledger</h2>
        <ol className="demo__ledger">
          {ledger.length === 0 ? (
            <li className="demo__empty">
              Every action lands here, including the ones that were refused.
            </li>
          ) : null}
          {[...ledger].reverse().map((r) => (
            <li key={r.id} className={`is-${r.outcome}`}>
              <span className="demo__outcome">{r.outcome.replace("_", " ")}</span>
              <span className="demo__summary">{r.summary}</span>
              {r.detail ? <span className="demo__detail">{r.detail}</span> : null}
            </li>
          ))}
        </ol>
        <p className="small">
          Model: {model || "…"}. Fake rails, fake sats. Policy engine, executor, ledger and
          confirmation protocol are the production code.
        </p>
      </aside>
    </div>
  )
}
