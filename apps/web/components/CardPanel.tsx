"use client"

import { useState } from "react"
import { VirtualCardFace } from "./VirtualCardFace"

export interface CardPanelProps {
  id: string
  name: string
  state: "active" | "paused"
  scope: readonly string[]
  monthlyCapSats: string
  spentSats: string
  resetsAt: string
  perActionCapSats?: string
  confirmAboveSats?: string
  canManage: boolean
  token?: string
}

const sats = (s: string) => `${Number(s).toLocaleString("en-US")} sats` // money-ok: display of an integer string

export function CardPanel(p: CardPanelProps) {
  const [state, setState] = useState(p.state)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const spent = Number(p.spentSats)
  const cap = Number(p.monthlyCapSats)
  const pct = cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : 0 // money-ok: a progress bar width
  async function toggle() {
    setBusy(true)
    setErr(null)
    const res = await fetch(`/api/card/${p.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: p.token, op: state === "active" ? "pause" : "resume" }),
    })
    const j = (await res.json()) as { ok: boolean; state?: "active" | "paused"; error?: string }
    setBusy(false)
    if (j.ok && j.state) setState(j.state)
    else setErr(j.error ?? "failed")
  }
  return (
    <section className="vcard">
      <VirtualCardFace
        id={p.id}
        name={p.name}
        state={state}
        scope={p.scope}
        monthlyCapSats={p.monthlyCapSats}
        spentSats={p.spentSats}
        resetsAt={p.resetsAt}
      />
      {p.canManage ? (
        <>
          <div className="vcard__meter" aria-hidden="true">
            <span style={{ width: `${pct}%` }} />
          </div>
          <dl className="vcard__facts">
            <div>
              <dt>Spent this month</dt>
              <dd>
                {sats(p.spentSats)} of {sats(p.monthlyCapSats)}
              </dd>
            </div>
            <div>
              <dt>Pays</dt>
              <dd>{p.scope.join(", ")}</dd>
            </div>
            <div>
              <dt>Funds held by</dt>
              <dd>Your own wallet</dd>
            </div>
            <div>
              <dt>Asks you above</dt>
              <dd>{p.confirmAboveSats ? sats(p.confirmAboveSats) : "your usual threshold"}</dd>
            </div>
            {p.perActionCapSats ? (
              <div>
                <dt>Max per payment</dt>
                <dd>{sats(p.perActionCapSats)}</dd>
              </div>
            ) : null}
          </dl>
          <div className="vcard__actions">
            <button type="button" className="cta" disabled={busy} onClick={toggle}>
              {state === "active" ? "Pause card" : "Resume card"}
            </button>
            <span className="small">Pausing is instant. Resume from here or in chat.</span>
          </div>
          {err ? <p className="small">{err}</p> : null}
        </>
      ) : (
        <p className="small">
          Open this page from the link the assistant gave you to see the budget and manage the card.
        </p>
      )}
    </section>
  )
}
