"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/me", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  return (await res.json()) as { ok: boolean; error?: string }
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="me__btn"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        } catch {
          /* clipboard blocked: the text is on screen to select */
        }
      }}
    >
      {done ? "Copied" : label}
    </button>
  )
}

export function ShareButton({ url, text, label }: { url: string; text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="me__btn me__btn--wide"
      onClick={async () => {
        try {
          if (navigator.share) await navigator.share({ url, text })
          else await navigator.clipboard.writeText(url)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        } catch {
          /* cancelled */
        }
      }}
    >
      <span aria-hidden="true">⇧</span> {done ? "Shared" : label}
    </button>
  )
}

function useOp() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const run = async (body: Record<string, unknown>) => {
    setBusy(true)
    setErr(null)
    setOk(false)
    const r = await post(body)
    setBusy(false)
    if (r.ok) {
      setOk(true)
      setTimeout(() => setOk(false), 1500)
      router.refresh()
    } else setErr(r.error ?? "That did not work")
    return r.ok
  }
  return { run, busy, err, ok }
}

export function LimitsForm(p: {
  token: string
  dailyCapSats: string
  perActionCapSats: string
  confirmAboveSats: string
}) {
  const { run, busy, err, ok } = useOp()
  const [v, setV] = useState({
    dailyCapSats: p.dailyCapSats,
    perActionCapSats: p.perActionCapSats,
    confirmAboveSats: p.confirmAboveSats,
  })
  const field = (k: keyof typeof v, label: string, sub: string) => (
    <label className="me__field">
      <span className="me__field-label">{label}</span>
      <span className="me__field-sub">{sub}</span>
      <input
        inputMode="numeric"
        value={v[k]}
        onChange={(e) => setV({ ...v, [k]: e.target.value })}
      />
    </label>
  )
  return (
    <form
      className="me__form"
      onSubmit={(e) => {
        e.preventDefault()
        void run({ token: p.token, op: "limits", ...v })
      }}
    >
      {field("dailyCapSats", "Daily cap", "Sats that may leave in any 24 hours")}
      {field("perActionCapSats", "Per action", "The most one payment may be")}
      {field(
        "confirmAboveSats",
        "Confirm above",
        "Payments at or above this ask you first; 0 asks every time",
      )}
      <div className="me__form-foot">
        <button type="submit" className="me__btn me__btn--dark" disabled={busy}>
          {ok ? "Saved" : "Save"}
        </button>
        {err ? <span className="me__err">{err}</span> : null}
      </div>
    </form>
  )
}

export function Toggle(p: {
  token: string
  on: boolean
  body: Record<string, unknown>
  onLabel?: string
  offLabel?: string
}) {
  const { run, busy, err } = useOp()
  return (
    <span className="me__toggle">
      {err ? <span className="me__err">{err}</span> : null}
      <button
        type="button"
        className={`me__btn${p.on ? "" : " me__btn--dark"}`}
        disabled={busy}
        onClick={() => void run({ token: p.token, ...p.body, on: !p.on })}
      >
        {p.on ? (p.onLabel ?? "Turn off") : (p.offLabel ?? "Turn on")}
      </button>
    </span>
  )
}

export function CardToggle(p: { token: string; id: string; state: "active" | "paused" }) {
  const { run, busy, err } = useOp()
  return (
    <span className="me__toggle">
      {err ? <span className="me__err">{err}</span> : null}
      <button
        type="button"
        className="me__btn"
        disabled={busy}
        onClick={() =>
          void run({
            token: p.token,
            op: "card",
            id: p.id,
            state: p.state === "active" ? "pause" : "resume",
          })
        }
      >
        {p.state === "active" ? "Pause" : "Resume"}
      </button>
    </span>
  )
}

export function DestinationList(p: {
  token: string
  kind: "allow" | "deny"
  items: readonly string[]
  placeholder: string
}) {
  const { run, busy, err } = useOp()
  const [text, setText] = useState("")
  return (
    <div className="me__list">
      {p.items.length ? (
        <ul>
          {p.items.map((d) => (
            <li key={d}>
              <code>{d}</code>
              <button
                type="button"
                className="me__link"
                disabled={busy}
                onClick={() => void run({ token: p.token, op: `${p.kind}_remove`, destination: d })}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="me__add"
        onSubmit={async (e) => {
          e.preventDefault()
          if (await run({ token: p.token, op: `${p.kind}_add`, destination: text })) setText("")
        }}
      >
        <input
          value={text}
          placeholder={p.placeholder}
          onChange={(e) => setText(e.target.value)}
          aria-label={p.kind === "allow" ? "Add a trusted destination" : "Block a destination"}
        />
        <button type="submit" className="me__btn" disabled={busy || !text.trim()}>
          Add
        </button>
      </form>
      {err ? <span className="me__err">{err}</span> : null}
    </div>
  )
}

export function LogoutButton(p: { token: string; all?: boolean; label: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      className={`me__btn${p.all ? "" : " me__btn--dark"}`}
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        await post({ token: p.token, op: p.all ? "logout_all" : "logout" })
        window.location.href = "/me"
      }}
    >
      {p.label}
    </button>
  )
}
