"use client"

import type { MerchantOrderView } from "@/lib/shop/service"
import { useEffect, useState } from "react"
import { usd } from "./ProductCard"

type P = {
  id: string
  title: string
  price: string
  deal?: string
  category: string
  kind: string
  inStock: boolean
}
const CATS = [
  "books",
  "apparel",
  "gift-cards",
  "home",
  "kids",
  "sports",
  "food",
  "art",
  "electronics",
  "other",
]

export function MerchantTools({
  slug,
  token,
  products,
}: { slug: string; token: string; products: P[] }) {
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    id: "",
    title: "",
    description: "",
    imageUrl: "",
    category: "books",
    price: "",
    deal: "",
    kind: "physical",
  })
  const [orders, setOrders] = useState<MerchantOrderView[] | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value })

  async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await fetch(`/api/receive/${slug}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, ...(body as object) }),
    })
    return (await res.json()) as Record<string, unknown>
  }
  const loadOrders = async () => {
    const j = await post("orders", {})
    setOrders((j.orders as MerchantOrderView[]) ?? [])
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount
  useEffect(() => {
    void loadOrders()
  }, [])

  async function save(e: { preventDefault(): void }) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const j = await post("products", { product: form })
    setMsg(j.ok ? `Saved ${j.id}.` : String(j.error))
    setBusy(false)
    if (j.ok) setTimeout(() => window.location.reload(), 600)
  }

  return (
    <div className="receive">
      <h2>Your store</h2>
      {products.length ? (
        <ul className="directory">
          {products.map((p) => (
            <li key={p.id}>
              <strong>{p.title}</strong> <code>{p.id}</code> · ${p.price}
              {p.deal ? ` (deal $${p.deal})` : ""} · {p.category} · {p.kind} ·{" "}
              {p.inStock ? "in stock" : "out of stock"} <a href={`/shop/p/${slug}/${p.id}`}>page</a>
              {" · "}
              <button
                type="button"
                className="demo__cancel"
                disabled={busy}
                onClick={() =>
                  post("products", { product: { ...p, inStock: !p.inStock } }).then(() =>
                    window.location.reload(),
                  )
                }
              >
                {p.inStock ? "mark out of stock" : "mark in stock"}
              </button>
              {" · "}
              <button
                type="button"
                className="demo__cancel"
                disabled={busy}
                onClick={() =>
                  post("products", { remove: p.id }).then(() => window.location.reload())
                }
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small">No products yet.</p>
      )}
      <h3>Add or update a product</h3>
      <form onSubmit={save}>
        <label>
          Title
          <input value={form.title} onChange={set("title")} required maxLength={120} />
        </label>
        <label>
          Id (optional; defaults from the title)
          <input value={form.id} onChange={set("id")} placeholder="esv-study-bible" />
        </label>
        <label>
          Description
          <input value={form.description} onChange={set("description")} maxLength={1000} />
        </label>
        <label>
          Image (https link)
          <input value={form.imageUrl} onChange={set("imageUrl")} />
        </label>
        <label>
          Category
          <select value={form.category} onChange={set("category")}>
            {CATS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          Price (USD)
          <input value={form.price} onChange={set("price")} placeholder="39.99" required />
        </label>
        <label>
          Deal price (optional)
          <input value={form.deal} onChange={set("deal")} />
        </label>
        <label>
          Kind
          <select value={form.kind} onChange={set("kind")}>
            <option value="physical">Physical (ships)</option>
            <option value="digital">Digital (you send a link in the order note)</option>
          </select>
        </label>
        <button type="submit" className="cta" disabled={busy}>
          Save product
        </button>
      </form>
      <h3>Orders</h3>
      {orders === null ? (
        <p className="small">Loading…</p>
      ) : orders.length === 0 ? (
        <p className="small">No orders yet.</p>
      ) : (
        <ol className="demo__ledger">
          {orders.map((o) => (
            <li
              key={o.id}
              className={`is-${o.state === "paid" || o.state === "fulfilled" ? "succeeded" : "pending"}`}
            >
              <span className="demo__outcome">{o.state}</span>
              <span className="demo__summary">
                {o.createdAt.slice(0, 16).replace("T", " ")} ·{" "}
                {o.items.map((i) => `${i.qty}× ${i.title}`).join(", ")} · ${usd(o.totalCents)} ·{" "}
                {o.totalSats.toLocaleString("en-US")} sats
              </span>
              {o.shipping ? (
                <span className="demo__detail">
                  Ship to: {o.shipping.name}, {o.shipping.address}, {o.shipping.city}
                  {o.shipping.region ? `, ${o.shipping.region}` : ""} {o.shipping.postal ?? ""},{" "}
                  {o.shipping.country}
                </span>
              ) : null}
              {o.contact ? <span className="demo__detail">Contact: {o.contact}</span> : null}
              {o.state === "paid" ? (
                <span className="demo__detail">
                  <input
                    value={notes[o.id] ?? ""}
                    onChange={(e) => setNotes({ ...notes, [o.id]: e.target.value })}
                    placeholder="Tracking number or download link"
                    style={{ width: "60%" }}
                  />{" "}
                  <button
                    type="button"
                    className="demo__cancel"
                    disabled={busy}
                    onClick={() =>
                      post("orders", { fulfil: { orderId: o.id, note: notes[o.id] } }).then(
                        loadOrders,
                      )
                    }
                  >
                    mark fulfilled
                  </button>
                </span>
              ) : null}
              {o.note ? <span className="demo__detail">Note: {o.note}</span> : null}
            </li>
          ))}
        </ol>
      )}
      {msg ? <p className="small">{msg}</p> : null}
    </div>
  )
}
