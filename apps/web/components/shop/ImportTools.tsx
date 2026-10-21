"use client"

import { useState } from "react"

export function ImportTools({ slug, token }: { slug: string; token: string }) {
  const [csv, setCsv] = useState("")
  const [shopify, setShopify] = useState("")
  const [host, setHost] = useState("")
  const [game, setGame] = useState("")
  const [replace, setReplace] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function run(body: Record<string, unknown>) {
    setBusy(true)
    setMsg(null)
    const res = await fetch(`/api/receive/${slug}/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, defaultGame: game || undefined, replace, ...body }),
    })
    const j = (await res.json()) as {
      ok: boolean
      error?: string
      imported?: number
      skipped?: { row: number; reason: string }[]
      remote?: boolean
    }
    setBusy(false)
    if (!j.ok) return setMsg(j.error ?? "failed")
    setMsg(
      `${j.imported} products ${j.remote ? "synced from your shop" : "imported"}${j.skipped?.length ? `; ${j.skipped.length} rows skipped (e.g. row ${j.skipped[0]?.row}: ${j.skipped[0]?.reason})` : ""}.`,
    )
    setTimeout(() => window.location.reload(), 900)
  }
  return (
    <div className="receive">
      <h3>Import your inventory</h3>
      <label>
        Game for cards without one (optional): pokemon, mtg, yugioh, lorcana…
        <input value={game} onChange={(e) => setGame(e.target.value)} placeholder="pokemon" />
      </label>
      <label>
        <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />{" "}
        Replace my current products with this import
      </label>
      <h4>
        Paste a CSV export (TCGplayer, BinderPOS, Crystal Commerce, or any sheet with title and
        price columns)
      </h4>
      <textarea
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        rows={6}
        style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
        placeholder={
          "Product Name,Set Name,Number,Condition,Price,Quantity\nCharizard,Base Set,4/102,LP,420.00,1"
        }
      />
      <button
        type="button"
        className="cta"
        disabled={busy || !csv.trim()}
        onClick={() => run({ csv })}
      >
        Import CSV
      </button>
      <h4>Or your Shopify store</h4>
      <label>
        Store link (we read its public products.json)
        <input
          value={shopify}
          onChange={(e) => setShopify(e.target.value)}
          placeholder="https://your-shop.myshopify.com"
        />
      </label>
      <button
        type="button"
        className="cta"
        disabled={busy || !shopify.trim()}
        onClick={() => run({ shopifyUrl: shopify })}
      >
        Import from Shopify
      </button>
      <h4>Or connect a shop that speaks the Anvard protocol</h4>
      <label>
        Shop host (serves https://host/.well-known/anvard.json)
        <input
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="cards.example.com"
        />
      </label>
      <button
        type="button"
        className="cta"
        disabled={busy || !host.trim()}
        onClick={() => run({ manifestHost: host })}
      >
        Connect shop
      </button>
      <p className="small">
        A connected shop mints its own invoices and ships its own orders; we list it and send
        buyers. The protocol is open:{" "}
        <a href="https://github.com/grahampatrick/agentic-bitcoin/blob/main/docs/protocol/anvard-commerce.md">
          read it
        </a>
        .
      </p>
      {msg ? <p className="small">{msg}</p> : null}
    </div>
  )
}
