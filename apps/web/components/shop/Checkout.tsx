"use client"

import type { ProductView } from "@/lib/shop/service"
import { useEffect, useState } from "react"
import { OrderStatus } from "./OrderStatus"
import { usd } from "./ProductCard"
import { getCart, rememberOrder, removeMerchant } from "./cart"

export function Checkout({
  merchantSlug,
  merchantName,
}: { merchantSlug: string; merchantName: string }) {
  const [lines, setLines] = useState<{ p: ProductView; qty: number }[]>([])
  const [ship, setShip] = useState({
    name: "",
    address: "",
    city: "",
    region: "",
    postal: "",
    country: "",
  })
  const [contact, setContact] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [orderId, setOrderId] = useState<string | null>(null)
  useEffect(() => {
    const c = getCart().filter((i) => i.gid.startsWith(`dir:${merchantSlug}:`))
    if (!c.length) return
    fetch(`/api/shop/products?ids=${encodeURIComponent(c.map((i) => i.gid).join(","))}`)
      .then((r) => r.json())
      .then((j: { products: ProductView[] }) =>
        setLines(
          c.flatMap((i) =>
            j.products.find((p) => p.gid === i.gid)
              ? [{ p: j.products.find((p) => p.gid === i.gid) as ProductView, qty: i.qty }]
              : [],
          ),
        ),
      )
  }, [merchantSlug])
  const needsShipping = lines.some((l) => l.p.kind === "physical")
  const total = lines.reduce((a, l) => a + l.p.payCents * l.qty, 0)
  const set = (k: keyof typeof ship) => (e: { target: { value: string } }) =>
    setShip({ ...ship, [k]: e.target.value })

  async function pay(e: { preventDefault(): void }) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch("/api/shop/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          merchantSlug,
          items: lines.map((l) => ({ productId: l.p.id, qty: l.qty })),
          shipping: needsShipping ? ship : undefined,
          contact,
        }),
      })
      const j = (await res.json()) as { ok: boolean; error?: string; orderId?: string }
      if (!j.ok || !j.orderId) throw new Error(j.error ?? "checkout failed")
      rememberOrder(j.orderId)
      removeMerchant(merchantSlug)
      setOrderId(j.orderId)
    } catch (x) {
      setErr((x as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (orderId) return <OrderStatus id={orderId} />
  if (!lines.length) return <p className="muted">Nothing from {merchantName} in your cart.</p>
  return (
    <div className="checkout">
      <form className="form" onSubmit={pay}>
        <h2 style={{ marginTop: 0 }}>{merchantName}</h2>
        <ul style={{ paddingLeft: 18 }}>
          {lines.map((l) => (
            <li key={l.p.gid}>
              {l.qty}× {l.p.title} — {usd(l.p.payCents * l.qty)}
            </li>
          ))}
        </ul>
        {needsShipping ? (
          <>
            <h3>Ship to</h3>
            <p className="muted">Sealed for {merchantName} only; we cannot read it.</p>
            <label>
              Full name
              <input value={ship.name} onChange={set("name")} required />
            </label>
            <label>
              Street address
              <input value={ship.address} onChange={set("address")} required />
            </label>
            <label>
              City
              <input value={ship.city} onChange={set("city")} required />
            </label>
            <label>
              State / region
              <input value={ship.region} onChange={set("region")} />
            </label>
            <label>
              Postal code
              <input value={ship.postal} onChange={set("postal")} />
            </label>
            <label>
              Country (2 letters)
              <input value={ship.country} onChange={set("country")} maxLength={2} required />
            </label>
          </>
        ) : null}
        <label>
          Email or phone for the merchant (optional
          {lines.some((l) => l.p.kind === "digital") ? ", recommended for digital goods" : ""})
          <input value={contact} onChange={(e) => setContact(e.target.value)} />
        </label>
        <button type="submit" className="btn" disabled={busy}>
          {busy ? "Asking the merchant's wallet…" : `Pay ${usd(total)} over Lightning`}
        </button>
        {err ? <p className="err">{err}</p> : null}
      </form>
      <aside className="invoice">
        <p className="muted">
          You will get one invoice, created by {merchantName}&rsquo;s own wallet. Agentic Bitcoin
          never holds the money.
        </p>
      </aside>
    </div>
  )
}
