import { ShopShell } from "@/components/shop/ShopShell"
import { BitrefillGoodsRail } from "@agentic-bitcoin/rails"
import Link from "next/link"

export const dynamic = "force-dynamic"

const QUERIES = ["steam", "playstation", "xbox", "nintendo", "roblox"]
// money-ok: integer cents split into dollars and cents for display only
const usd = (cents: bigint) => `$${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`

export default async function GamingPage() {
  const key = process.env.BITREFILL_API_KEY
  let cards: { id: string; name: string; usdCents: bigint | null }[] = []
  let note: string | null = null
  if (key) {
    try {
      const rail = new BitrefillGoodsRail({ apiKey: key })
      const seen = new Set<string>()
      for (const q of QUERIES) {
        for (const p of await rail.searchProducts(q)) {
          if (!seen.has(p.id)) {
            seen.add(p.id)
            cards.push(p)
          }
        }
      }
    } catch (err) {
      note = `Bitrefill is not answering right now (${(err as Error).message}).`
      cards = []
    }
  } else
    note =
      "Gift cards are available by text today; the web listing appears once the operator connects Bitrefill."
  return (
    <ShopShell active="categories">
      <h1 style={{ fontSize: 28 }}>Gaming</h1>
      <p className="muted">
        Steam, PlayStation, Xbox and Nintendo cards through Bitrefill, delivered as codes. Text
        Agentic Bitcoin: <code>get me a $25 steam gift card</code>.{" "}
        <Link href="/text">Not texting yet?</Link>
      </p>
      {note ? <p className="demo-note">{note}</p> : null}
      {cards.length ? (
        <ul className="directory">
          {cards.slice(0, 60).map((c) => (
            <li key={c.id}>
              <strong>{c.name}</strong> <code>{c.id}</code>
              {c.usdCents !== null ? (
                <span className="directory__meta"> · {usd(c.usdCents)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </ShopShell>
  )
}
