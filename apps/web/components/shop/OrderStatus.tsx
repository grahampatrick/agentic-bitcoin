"use client"

import type { OrderView } from "@/lib/shop/service"
import QRCode from "qrcode"
import { useEffect, useState } from "react"
import { usd } from "./ProductCard"

export function OrderStatus({ id, initial }: { id: string; initial?: OrderView | null }) {
  const [o, setO] = useState<OrderView | null | undefined>(initial)
  const [qr, setQr] = useState<string | null>(null)
  const [preimage, setPreimage] = useState("")
  const [msg, setMsg] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      const res = await fetch(`/api/shop/orders/${id}`, { cache: "no-store" })
      if (!alive) return
      if (!res.ok) return setO(null)
      const j = (await res.json()) as OrderView
      setO(j)
      if (j.state === "unpaid") setTimeout(tick, 4000)
    }
    void tick()
    return () => {
      alive = false
    }
  }, [id])
  useEffect(() => {
    if (!o || o.state !== "unpaid") return setQr(null)
    QRCode.toDataURL(`lightning:${o.bolt11}`.toUpperCase(), { margin: 1, width: 256 })
      .then(setQr)
      .catch(() => setQr(null))
  }, [o])

  if (o === null) return <p className="err">Order not found.</p>
  if (!o) return <p className="muted">Loading…</p>
  return (
    <div className="invoice">
      <p>
        <span className={`status is-${o.state}`}>{o.state}</span> · {usd(o.totalCents)} ·{" "}
        {o.totalSats.toLocaleString("en-US")} sats · from {o.merchantName}
      </p>
      <ul style={{ listStyle: "none", padding: 0, margin: "8px 0", textAlign: "left" }}>
        {o.items.map((i) => (
          <li key={i.productId}>
            {i.qty}× {i.title} <span className="muted">{usd(i.priceCents)}</span>
          </li>
        ))}
      </ul>
      {o.state === "unpaid" ? (
        <>
          {qr ? <img src={qr} alt="Lightning invoice QR code" /> : null}
          <p className="muted">
            Invoice created by {o.merchantName}&rsquo;s wallet, valid 10 minutes. Scan it or{" "}
            <a href={`lightning:${o.bolt11}`}>open in your wallet</a>.
          </p>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() =>
              void navigator.clipboard?.writeText(o.bolt11).then(() => setCopied(true))
            }
          >
            {copied ? "Copied" : "Copy invoice"}
          </button>
          {o.canVerify ? (
            <p className="muted">
              This page updates itself when the merchant&rsquo;s wallet sees the payment.
            </p>
          ) : (
            <form
              className="form"
              onSubmit={async (e) => {
                e.preventDefault()
                setMsg(null)
                const res = await fetch(`/api/shop/orders/${id}`, {
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
                Paid? Paste the payment preimage your wallet shows (proof of payment)
                <input
                  value={preimage}
                  onChange={(e) => setPreimage(e.target.value)}
                  placeholder="64 hex characters"
                />
              </label>
              <button type="submit" className="btn btn--ghost" disabled={preimage.length < 64}>
                Confirm payment
              </button>
              {msg ? <p className="err">{msg}</p> : null}
            </form>
          )}
        </>
      ) : (
        <p>
          {o.state === "paid" ? "Paid. " : "Fulfilled. "}
          {o.hasShipping ? "The merchant has your shipping details and will send it. " : ""}
          {o.note ? <span>Merchant note: {o.note}</span> : null}
        </p>
      )}
      <p className="muted" style={{ fontSize: 13 }}>
        Order {o.id} · payment hash {o.paymentHash.slice(0, 16)}… · Agentic Bitcoin never holds the
        money; for refunds contact the merchant.
      </p>
    </div>
  )
}
