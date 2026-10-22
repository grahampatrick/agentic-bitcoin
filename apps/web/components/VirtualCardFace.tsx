"use client"

import { useState } from "react"

export interface VirtualCardFaceProps {
  id: string
  name: string
  state: "active" | "paused"
  scope: readonly string[]
  /** Integer sats as a string (bigint-safe across the server boundary). */
  monthlyCapSats: string
  spentSats: string
  resetsAt: string
}

const sats = (s: string) => Number(s).toLocaleString("en-US") // money-ok: display of an integer string
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const shortDate = (iso: string) => {
  const d = new Date(iso)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}
/** card_abc123 → "ABC1 2300 …" grouped like an embossed number. */
const groups = (id: string) => {
  const raw = id
    .replace(/^card_/, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .padEnd(16, "0")
    .slice(0, 16)
  return raw.match(/.{1,4}/g)?.join(" ") ?? raw
}

/** The chip, with the bolt etched into it the way the reference etches its mark. */
function Chip() {
  return (
    <svg className="mini__chip" viewBox="0 0 40 30" aria-hidden="true" focusable="false">
      <rect x="0.5" y="0.5" width="39" height="29" rx="5" fill="#c9c6c0" stroke="#8f8b85" />
      <path
        d="M0.5 10h11a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3h-11M39.5 10h-11a3 3 0 0 0-3 3v4a3 3 0 0 0 3 3h11"
        fill="none"
        stroke="#8f8b85"
        strokeWidth="0.9"
      />
      <path d="M21.6 6.5 16 15h3.9l-1.4 8.5L24 14h-3.9z" fill="#5e5b56" />
    </svg>
  )
}

/**
 * A matte black mini tag, after the small hardware cards people already carry: bevelled rim, a
 * keyring hole, one chip, and the card number debossed along the bottom edge. Nothing else on the
 * face. Click or press Enter to turn it over; the back carries the one sentence that matters.
 */
export function VirtualCardFace(p: VirtualCardFaceProps) {
  const [back, setBack] = useState(false)
  const paused = p.state === "paused"
  return (
    <div className="stage">
      <button
        type="button"
        className={`mini${back ? " is-back" : ""}${paused ? " is-paused" : ""}`}
        onClick={() => setBack((b) => !b)}
        aria-pressed={back}
        aria-label={`${p.name} virtual Lightning card, ${paused ? "paused" : "active"}. ${back ? "Showing the back." : "Showing the front."} Press to flip.`}
      >
        <span className="mini__body">
          <span className="mini__face mini__front">
            <span className="mini__hole" aria-hidden="true" />
            <Chip />
            <span className="mini__number">{groups(p.id)}</span>
          </span>
          <span className="mini__face mini__back">
            <span className="mini__hole" aria-hidden="true" />
            <span className="mini__etched mini__motto">
              A policy on your wallet, not a balance.
            </span>
            <span className="mini__etched mini__spec">
              {sats(p.monthlyCapSats)} sats a month · resets {shortDate(p.resetsAt)}
              <br />
              {sats(p.spentSats)} spent · pays {p.scope.length ? p.scope.join(", ") : "—"}
            </span>
            <span className="mini__etched mini__foot">anvard.ai · born at block 970,396</span>
          </span>
        </span>
      </button>
      <span className="stage__caption">
        <span className="stage__pill">{paused ? "Paused" : "Active"}</span>
        <span className="stage__title">{p.name}</span>
        <span className="stage__hint">Tap the card to turn it over</span>
      </span>
    </div>
  )
}
