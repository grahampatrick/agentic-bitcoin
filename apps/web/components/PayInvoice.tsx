"use client"

import type { PayView } from "@/lib/invoices/service"
import QRCode from "qrcode"
import { useEffect, useState } from "react"

const usd = (c: number) => `$${(c / 100).toFixed(2)}` // money-ok: display of an integer-cent value

export function PayInvoice({ token, initial }: { token: string; initial: PayView }) {
  const [v, setV] = useState<PayView>(initial)
  const [qr, setQr] = useState<string | null>(null)
  const [preimage, setPreimage] = useState("")
  const [msg, setMsg] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    let alive = true
    const tick = async () => {
      const res = await fetch(`/api/pay/${token}`, { cache: "no-store" })
      if (!alive || !res.ok) return
      const j = (await res.json()) as PayView
      setV(j)
      if (j.status === "open" || j.status === "overdue") setTimeout(tick, 5000)
    }
    const t = setTimeout(tick, 5000)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [token])
  useEffect(() => {
    if (!v.bolt11) return setQr(null)
    QRCode.toDataURL(`lightning:${v.bolt11}`.toUpperCase(), { margin: 1, width: 256 })
      .then(setQr)
      .catch(() => setQr(null))
  }, [v.bolt11])
  const payable = v.bolt11 && (v.status === "open" || v.status === "overdue")
  return (
    <div className="give">
      <table className="items">
        <tbody>
          {v.items.map((i, n) => (
            <tr key={`${n}-${i.description}`}>
              <td>
                {i.qty > 1 ? `${i.qty}× ` : ""}
                {i.description}
              </td>
              <td style={{ textAlign: "right" }}>{usd(i.unitCents * i.qty)}</td>
            </tr>
          ))}
          <tr>
            <td>
              <strong>Total</strong>
            </td>
            <td style={{ textAlign: "right" }}>
              <strong>{usd(v.totalCents)}</strong>
              {v.amountSats ? (
                <span className="small"> · {v.amountSats.toLocaleString("en-US")} sats</span>
              ) : null}
            </td>
          </tr>
        </tbody>
      </table>
      {v.memo ? <p className="small">{v.memo}</p> : null}
      {v.status === "paid" ? (
        <p>
          <strong>Paid</strong>
          {v.paidAt ? ` on ${v.paidAt.slice(0, 10)}` : ""}. Thank you.
        </p>
      ) : v.status === "void" ? (
        <p>This invoice was cancelled by the issuer.</p>
      ) : v.status === "expired" ? (
        <p>This Lightning invoice has expired. Ask {v.issuerName} to renew the link.</p>
      ) : payable ? (
        <div className="give__invoice">
          {qr ? <img src={qr} alt="Lightning invoice QR code" width={256} height={256} /> : null}
          <p className="small">
            Lightning invoice created by {v.issuerName}&rsquo;s wallet
            {v.amountSats ? ` for ${v.amountSats.toLocaleString("en-US")} sats` : ""}. Scan it or{" "}
            <a href={`lightning:${v.bolt11}`}>open in your wallet</a>.
            {v.dueAt ? ` Due ${v.dueAt.slice(0, 10)}.` : ""}
          </p>
          <button
            type="button"
            className="demo__cancel"
            onClick={() =>
              void navigator.clipboard?.writeText(v.bolt11 ?? "").then(() => setCopied(true))
            }
          >
            {copied ? "Copied" : "Copy invoice"}
          </button>
          {v.canVerify ? (
            <p className="small">This page updates itself when the payment lands.</p>
          ) : (
            <form
              className="receive"
              onSubmit={async (e) => {
                e.preventDefault()
                setMsg(null)
                const res = await fetch(`/api/pay/${token}`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ preimage }),
                })
                const j = (await res.json()) as { ok: boolean; error?: string }
                if (!j.ok) setMsg(j.error ?? "That did not match.")
                else window.location.reload()
              }}
            >
              <label>
                Paid? Paste the payment preimage your wallet shows to mark it paid
                <input
                  value={preimage}
                  onChange={(e) => setPreimage(e.target.value)}
                  placeholder="64 hex characters"
                />
              </label>
              <button type="submit" className="demo__cancel" disabled={preimage.length < 64}>
                Confirm payment
              </button>
              {msg ? <p className="give__err">{msg}</p> : null}
            </form>
          )}
          <p className="small">
            Have Agentic Bitcoin? Text it:{" "}
            <code>pay this {typeof window === "undefined" ? "" : window.location.href}</code>
          </p>
        </div>
      ) : (
        <p className="small">Preparing the Lightning invoice…</p>
      )}
    </div>
  )
}
