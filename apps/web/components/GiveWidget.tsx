"use client"

import QRCode from "qrcode"
import { useEffect, useState } from "react"

type Props = {
  slug: string
  name: string
  mode: "give" | "tip"
  lightningAddress: string
  verified: boolean
}

const PRESETS: Record<Props["mode"], number[]> = {
  give: [1_000, 5_000, 21_000, 100_000],
  tip: [100, 500, 2_100, 10_000],
}

export function GiveWidget({ slug, name, mode, lightningAddress, verified }: Props) {
  const [sats, setSats] = useState<number>(PRESETS[mode][1] ?? 1000)
  const [note, setNote] = useState("")
  const [pr, setPr] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!pr) return setQr(null)
    QRCode.toDataURL(`lightning:${pr}`.toUpperCase(), { margin: 1, width: 256 })
      .then(setQr)
      .catch(() => setQr(null))
  }, [pr])

  async function getInvoice() {
    setBusy(true)
    setErr(null)
    setPr(null)
    try {
      const q = new URLSearchParams({ amount: String(sats * 1000) })
      if (note.trim()) q.set("comment", note.trim().slice(0, 200))
      const res = await fetch(`/api/lnurlp/${slug}/callback?${q}`)
      const j = (await res.json()) as { pr?: string; reason?: string }
      if (!res.ok || !j.pr) throw new Error(j.reason ?? "could not create an invoice")
      setPr(j.pr)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="give">
      <div className="give__presets">
        {PRESETS[mode].map((p) => (
          <button
            type="button"
            key={p}
            className={p === sats ? "is-on" : ""}
            onClick={() => setSats(p)}
            disabled={busy}
          >
            {p.toLocaleString("en-US")} sats
          </button>
        ))}
        <input
          type="number"
          min={1}
          max={10_000_000}
          value={sats}
          onChange={(e) => setSats(Math.max(1, Math.floor(Number(e.target.value) || 0)))}
          aria-label="Amount in sats"
        />
      </div>
      <input
        className="give__note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={200}
        placeholder={mode === "tip" ? "A note (optional)" : "What this is for (optional)"}
        aria-label="Note to the recipient"
      />
      <button type="button" className="cta" onClick={getInvoice} disabled={busy || sats < 1}>
        {busy
          ? "Asking their wallet…"
          : `${mode === "tip" ? "Tip" : "Give"} ${sats.toLocaleString("en-US")} sats`}
      </button>
      {err ? <p className="give__err">{err}</p> : null}
      {pr ? (
        <div className="give__invoice">
          {qr ? <img src={qr} alt="Lightning invoice QR code" width={256} height={256} /> : null}
          <p className="small">
            Invoice created by {name}&rsquo;s wallet. Scan it or{" "}
            <a href={`lightning:${pr}`}>open in your wallet</a>.
          </p>
          <button
            type="button"
            className="demo__cancel"
            onClick={() => {
              void navigator.clipboard?.writeText(pr).then(() => setCopied(true))
            }}
          >
            {copied ? "Copied" : "Copy invoice"}
          </button>
        </div>
      ) : null}
      <p className="small">
        Lightning address: <code>{lightningAddress}</code>
        {verified ? null : " · not yet verified by us"}. Or text Agentic Bitcoin:{" "}
        <code>
          {mode === "tip" ? "tip" : "give"} {sats} sats to {slug}
        </code>
      </p>
    </div>
  )
}
