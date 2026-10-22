"use client"

import { useState } from "react"
import { Logo } from "./Logo"

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
/** card_abc123 → "ABC1 23" style grouping for the number line. */
const groups = (id: string) => {
  const raw = id
    .replace(/^card_/, "")
    .toUpperCase()
    .padEnd(8, "0")
    .slice(0, 12)
  return raw.match(/.{1,4}/g)?.join(" ") ?? raw
}

function Bolt({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <circle cx="24" cy="24" r="22" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M26.5 9 14 27h9.2L21.5 39 34 21h-9.2z" fill="currentColor" />
    </svg>
  )
}

function Chip() {
  return (
    <svg className="vcf__chip" viewBox="0 0 44 32" aria-hidden="true" focusable="false">
      <rect
        x="0.7"
        y="0.7"
        width="42.6"
        height="30.6"
        rx="5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M0.7 11h13a4 4 0 0 1 4 4v2a4 4 0 0 1-4 4h-13M43.3 11h-13a4 4 0 0 0-4 4v2a4 4 0 0 0 4 4h13M17.7 0.7v30.6M26.3 0.7v30.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  )
}

/**
 * The card itself: ink front with the engraved-line finish, a paper back with the one sentence that
 * matters. Click or press Enter to flip. The face carries the budget, never a balance.
 */
export function VirtualCardFace(p: VirtualCardFaceProps) {
  const [back, setBack] = useState(false)
  const paused = p.state === "paused"
  return (
    <button
      type="button"
      className={`vcf${back ? " is-back" : ""}${paused ? " is-paused" : ""}`}
      onClick={() => setBack((b) => !b)}
      aria-pressed={back}
      aria-label={`${p.name} virtual Lightning card, ${paused ? "paused" : "active"}. ${back ? "Showing the back." : "Showing the front."} Press to flip.`}
    >
      <span className="vcf__inner">
        <span className="vcf__face vcf__front">
          <span className="vcf__lines" aria-hidden="true" />
          <Logo className="vcf__ghost" />
          <span className="vcf__top">
            <span className="vcf__brand">
              <span className="vcf__wordmark">ANVARD</span>
              <span className="vcf__kind">lightning debit</span>
            </span>
            <Bolt className="vcf__bolt" />
          </span>
          <Chip />
          <span className="vcf__name">{p.name}</span>
          <span className="vcf__bottom">
            <span className="vcf__number">{groups(p.id)}</span>
            <span className="vcf__limit">
              <span className="vcf__limit-sats">{sats(p.monthlyCapSats)} sats</span>
              <span className="vcf__limit-sub">a month · resets {shortDate(p.resetsAt)}</span>
            </span>
          </span>
          {paused ? <span className="vcf__stamp">Paused</span> : null}
        </span>
        <span className="vcf__face vcf__back">
          <span className="vcf__stripe" aria-hidden="true" />
          <span className="vcf__back-body">
            <span className="vcf__motto">A policy on your wallet, not a balance.</span>
            <span className="vcf__back-row">
              <span className="vcf__back-k">Pays</span>
              <span className="vcf__back-v">{p.scope.length ? p.scope.join(" · ") : "—"}</span>
            </span>
            <span className="vcf__back-row">
              <span className="vcf__back-k">This month</span>
              <span className="vcf__back-v">
                {sats(p.spentSats)} of {sats(p.monthlyCapSats)} sats
              </span>
            </span>
            <span className="vcf__back-row">
              <span className="vcf__back-k">Funds</span>
              <span className="vcf__back-v">
                Stay in your wallet until you pay. Pausing is instant.
              </span>
            </span>
          </span>
          <span className="vcf__back-foot">
            <span className="vcf__mono">{p.id}</span>
            <span className="vcf__mono">born at block 970,396</span>
          </span>
        </span>
      </span>
    </button>
  )
}
