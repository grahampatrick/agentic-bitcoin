"use client"

import type { PriceQuote } from "@/lib/price/feed"
import { formatSats, formatUsd } from "@/lib/price/money"
import { useEffect, useState } from "react"

const REFRESH_MS = 60_000

/**
 * Renders with the server-fetched quote on first paint (no spinner), then refreshes from
 * /api/price once a minute and ticks the "updated Ns ago" label locally.
 */
export function LivePrice({ initial }: { initial: PriceQuote | null }) {
  const [quote, setQuote] = useState<PriceQuote | null>(initial)
  const [now, setNow] = useState<number>(() => Date.now())

  useEffect(() => {
    let cancelled = false
    async function refresh() {
      try {
        const res = await fetch("/api/price", { cache: "no-store" })
        if (!res.ok) return
        const q = (await res.json()) as PriceQuote
        if (!cancelled) setQuote(q)
      } catch {
        /* keep the last value; the label will show it ageing */
      }
    }
    if (!initial) void refresh()
    const poll = setInterval(refresh, REFRESH_MS)
    const tick = setInterval(() => setNow(Date.now()), 1_000)
    return () => {
      cancelled = true
      clearInterval(poll)
      clearInterval(tick)
    }
  }, [initial])

  if (!quote) {
    return (
      <p className="price" aria-live="polite">
        1 BTC = <span className="price__num">—</span>
      </p>
    )
  }

  const ageS = Math.max(0, Math.floor((now - Date.parse(quote.asOf)) / 1000))
  const age = ageS < 60 ? `${ageS}s` : `${Math.floor(ageS / 60)}m`

  return (
    <p className="price" aria-live="polite">
      <span>
        1 BTC = <span className="price__num">{formatUsd(quote.usdCents)}</span>
      </span>
      <span className="price__sep" aria-hidden="true">
        ·
      </span>
      <span>
        <span className="price__num">{formatSats(quote.satsPerDollar)}</span> sats per dollar
      </span>
      <span className="price__sep" aria-hidden="true">
        ·
      </span>
      <span className="price__age">
        {quote.stale ? "last known, " : "updated "}
        {age} ago
      </span>
    </p>
  )
}
