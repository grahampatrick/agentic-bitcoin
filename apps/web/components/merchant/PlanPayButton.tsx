"use client"

import { useState } from "react"

/** Asks the server for the open plan invoice (issuing one if needed) and goes to its pay page. */
export function PlanPayButton({
  slug,
  token,
  label,
}: { slug: string; token: string; label: string }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function go() {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/receive/${slug}/plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      })
      const j = (await res.json()) as { ok: boolean; link?: string; error?: string }
      if (j.ok && j.link) window.location.href = j.link
      else setErr(j.error ?? "Could not create the invoice.")
    } catch {
      setErr("Could not reach the server.")
    }
    setBusy(false)
  }
  return (
    <span className="mp__plan-pay">
      <button type="button" className="mp__btn mp__btn--solid" onClick={go} disabled={busy}>
        {busy ? "One moment…" : label}
      </button>
      {err ? <span className="mp__err">{err}</span> : null}
    </span>
  )
}
