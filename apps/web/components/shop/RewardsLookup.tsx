"use client"

import { useState } from "react"

type R = {
  pendingSats: string | number
  payableSats: string | number
  paidSats: string | number
  count: number
  nextPayableAt?: string
  rewards: { orderId: string; amountSats: number; state: string; payableAt: string }[]
}

export function RewardsLookup() {
  const [address, setAddress] = useState("")
  const [r, setR] = useState<R | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const n = (v: string | number) => Number(v).toLocaleString("en-US")
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault()
        setErr(null)
        const res = await fetch(`/api/rewards?address=${encodeURIComponent(address.trim())}`)
        const j = (await res.json()) as R & { error?: string }
        if (!res.ok) return setErr(j.error ?? "error")
        setR(j)
      }}
    >
      <label>
        The Lightning address you gave at checkout
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="you@getalby.com"
        />
      </label>
      <button type="submit" className="btn btn--ghost">
        Look up
      </button>
      {err ? <p className="err">{err}</p> : null}
      {r ? (
        <p>
          {r.count ? (
            <>
              <strong>{n(r.paidSats)} sats</strong> paid · <strong>{n(r.payableSats)} sats</strong>{" "}
              payable now · {n(r.pendingSats)} sats pending
              {r.nextPayableAt ? ` (next on ${r.nextPayableAt.slice(0, 10)})` : ""}
            </>
          ) : (
            "No rewards for that address yet."
          )}
        </p>
      ) : null}
    </form>
  )
}
