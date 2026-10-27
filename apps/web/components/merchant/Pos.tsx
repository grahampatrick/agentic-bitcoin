"use client"

import { useState } from "react"

/** A counter POS: type dollars, see sats, create a payment request, show the pay page. */
export function Pos({
  slug,
  token,
  satsPerDollar,
}: { slug: string; token: string; satsPerDollar: number | null }) {
  const [amount, setAmount] = useState("")
  const [note, setNote] = useState("")
  const [link, setLink] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const cents = Math.round(Number(amount || "0") * 100) // money-ok: keypad input → integer cents
  const dollars = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`
  const sats = satsPerDollar ? Math.round((cents / 100) * satsPerDollar) : null // money-ok: display estimate
  const press = (k: string) => {
    setErr(null)
    if (k === "⌫") return setAmount((a) => a.slice(0, -1))
    if (k === "." && amount.includes(".")) return
    if (amount.includes(".") && amount.split(".")[1]?.length === 2) return
    if (amount.length > 8) return
    setAmount((a) => (a === "0" && k !== "." ? k : a + k))
  }
  async function charge() {
    if (cents < 1) return setErr("Enter an amount.")
    setBusy(true)
    setErr(null)
    const res = await fetch(`/api/receive/${slug}/invoices`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token,
        create: {
          kind: "request",
          payerName: "Walk-in",
          items: [{ description: note.trim() || "POS sale", qty: 1, price: dollars }],
        },
      }),
    })
    const j = (await res.json()) as { ok: boolean; link?: string; error?: string }
    setBusy(false)
    if (!j.ok || !j.link) return setErr(j.error ?? "Could not create the request.")
    setLink(j.link)
  }
  if (link)
    return (
      <div className="pos pos--done">
        <p className="pos__amount">${dollars}</p>
        <p className="mp__muted">{sats !== null ? `${sats.toLocaleString("en-US")} sats` : ""}</p>
        <iframe title="Pay page" src={link} className="pos__frame" />
        <p className="mp__muted">
          Show this screen, or send the link: <a href={link}>{link}</a>
        </p>
        <button
          type="button"
          className="mp__btn"
          onClick={() => {
            setLink(null)
            setAmount("")
            setNote("")
          }}
        >
          New sale
        </button>
      </div>
    )
  return (
    <div className="pos">
      <div className="pos__display">
        <p className="pos__amount">${amount || "0"}</p>
        <p className="mp__muted">
          {sats !== null ? `${sats.toLocaleString("en-US")} sats` : "price unavailable"}
        </p>
      </div>
      <input
        className="pos__note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What for (optional)"
        aria-label="Note"
      />
      <div className="pos__keys">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"].map((k) => (
          <button
            type="button"
            key={k}
            onClick={() => press(k)}
            aria-label={k === "⌫" ? "Delete" : k}
          >
            {k}
          </button>
        ))}
      </div>
      <button type="button" className="pos__charge" disabled={busy} onClick={charge}>
        Charge ${amount || "0"}
      </button>
      {err ? <p className="mp__err">{err}</p> : null}
      <p className="mp__muted">
        Paid to your own wallet. The customer scans from any Lightning wallet.
      </p>
    </div>
  )
}
