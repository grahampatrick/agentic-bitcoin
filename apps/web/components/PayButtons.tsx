"use client"

import { WALLETS } from "@/lib/wallets"
import { useEffect, useState } from "react"

type WebLN = { enable(): Promise<void>; sendPayment(pr: string): Promise<{ preimage: string }> }

/**
 * One tap to pay (M15): `lightning:` link first, the installed browser wallet (WebLN) when present,
 * a list of named wallets behind "More wallets", copy as the last resort. When the browser wallet
 * pays, we get the preimage back and hand it to the page, which proves the payment server-side.
 */
export function PayButtons({
  bolt11,
  label,
  onPreimage,
}: {
  bolt11: string
  label?: string
  onPreimage?: (preimage: string) => Promise<void> | void
}) {
  const [webln, setWebln] = useState<WebLN | null>(null)
  const [busy, setBusy] = useState(false)
  const [more, setMore] = useState(false)
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    const w = (window as unknown as { webln?: WebLN }).webln
    if (w) setWebln(w)
  }, [])
  const generic = WALLETS[0]
  return (
    <div className="paybtns">
      {webln ? (
        <button
          type="button"
          className="cta"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setErr(null)
            try {
              await webln.enable()
              const r = await webln.sendPayment(bolt11)
              if (r?.preimage) await onPreimage?.(r.preimage)
            } catch (e) {
              setErr((e as Error).message || "The wallet did not pay.")
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? "Paying…" : (label ?? "Pay with your browser wallet")}
        </button>
      ) : null}
      <a className="cta" href={generic?.url(bolt11)}>
        {label && !webln ? label : "Open in your wallet"}
      </a>
      <button type="button" className="demo__cancel" onClick={() => setMore(!more)}>
        {more ? "Fewer wallets" : "More wallets"}
      </button>
      {more ? (
        <div className="paybtns__list">
          {WALLETS.filter((w) => w.id !== "generic").map((w) => (
            <a key={w.id} href={w.url(bolt11)} className="demo__cancel">
              {w.name}
            </a>
          ))}
          <button
            type="button"
            className="demo__cancel"
            onClick={() => void navigator.clipboard?.writeText(bolt11).then(() => setCopied(true))}
          >
            {copied ? "Copied" : "Copy invoice"}
          </button>
        </div>
      ) : null}
      {err ? <p className="give__err">{err}</p> : null}
    </div>
  )
}
