"use client"

import type { ProductView } from "@/lib/shop/service"
import Link from "next/link"
import { useEffect, useState } from "react"
import { usd } from "./ProductCard"
import { type CartItem, getCart, onCartChange, setCart } from "./cart"

export function CartView() {
  const [items, setItems] = useState<CartItem[]>([])
  const [products, setProducts] = useState<Record<string, ProductView>>({})
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    const load = async () => {
      const c = getCart()
      setItems(c)
      if (c.length) {
        const res = await fetch(
          `/api/shop/products?ids=${encodeURIComponent(c.map((i) => i.gid).join(","))}`,
        )
        const j = (await res.json()) as { products: ProductView[] }
        setProducts(Object.fromEntries(j.products.map((p) => [p.gid, p])))
      }
      setLoaded(true)
    }
    void load()
    return onCartChange(() => void load())
  }, [])
  const groups = new Map<string, { p: ProductView; qty: number }[]>()
  for (const i of items) {
    const p = products[i.gid]
    if (p) groups.set(p.merchantSlug, [...(groups.get(p.merchantSlug) ?? []), { p, qty: i.qty }])
  }
  const change = (gid: string, qty: number) =>
    setCart(getCart().map((i) => (i.gid === gid ? { ...i, qty } : i)))
  if (!loaded) return <p className="muted">Loading your cart…</p>
  if (!items.length)
    return (
      <p className="muted">
        Your cart is empty. <Link href="/shop">Browse the store.</Link>
      </p>
    )
  return (
    <>
      {[...groups.entries()].map(([merchant, lines]) => {
        const total = lines.reduce((a, l) => a + l.p.payCents * l.qty, 0)
        const totalSats = lines.reduce((a, l) => a + (l.p.paySats ?? 0) * l.qty, 0)
        return (
          <section key={merchant} className="cart-group">
            <h2 style={{ margin: 0 }}>{lines[0]?.p.merchantName}</h2>
            <p className="muted">One Lightning invoice from this merchant's wallet.</p>
            {lines.map(({ p, qty }) => (
              <div key={p.gid} className="cart-line">
                <div>
                  <Link href={p.url.replace(/^https?:\/\/[^/]+/, "")}>
                    <strong>{p.title}</strong>
                  </Link>
                  <div className="muted">
                    {usd(p.payCents)} · {p.kind === "physical" ? "ships" : "digital"}
                  </div>
                </div>
                <span className="qty">
                  <button type="button" onClick={() => change(p.gid, qty - 1)} aria-label="Fewer">
                    −
                  </button>
                  <span>{qty}</span>
                  <button
                    type="button"
                    onClick={() => change(p.gid, Math.min(99, qty + 1))}
                    aria-label="More"
                  >
                    +
                  </button>
                </span>
                <strong>{usd(p.payCents * qty)}</strong>
              </div>
            ))}
            <div className="cart-line" style={{ gridTemplateColumns: "1fr auto" }}>
              <span>
                Total <strong>{usd(total)}</strong>{" "}
                <span className="muted">≈ {totalSats.toLocaleString("en-US")} sats</span>
              </span>
              <Link href={`/shop/checkout/${merchant}`} className="btn">
                Checkout
              </Link>
            </div>
          </section>
        )
      })}
    </>
  )
}
