import { AddToCart } from "@/components/shop/AddToCart"
import { sats, usd } from "@/components/shop/ProductCard"
import { ShopShell } from "@/components/shop/ShopShell"
import { shopDepsFor } from "@/lib/shop/deps"
import { viewProducts } from "@/lib/shop/service"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: { params: Promise<{ merchant: string; id: string }> }): Promise<Metadata> {
  const { merchant, id } = await params
  const p = await shopDepsFor().products.get(merchant, id)
  return { title: p ? `${p.title} · Shop · Agentic Bitcoin` : "Shop · Agentic Bitcoin" }
}

export default async function ProductPage({
  params,
}: { params: Promise<{ merchant: string; id: string }> }) {
  const { merchant, id } = await params
  const deps = shopDepsFor()
  const raw = await deps.products.get(merchant, id)
  const [p] = raw ? await viewProducts(deps, [raw]) : []
  if (!p) notFound()
  const physical = p.kind === "physical"
  return (
    <ShopShell active="home">
      <div className="product">
        <div className="product__img">
          {p.imageUrl ? <img src={p.imageUrl} alt="" /> : <span>{p.title}</span>}
        </div>
        <div>
          <p className="muted">
            <Link href={`/shop/m/${p.merchantSlug}`}>{p.merchantName}</Link> · {p.category}
          </p>
          <h1>{p.title}</h1>
          <p className="product__price">
            <strong>{usd(p.payCents)}</strong>
            {p.saveCents ? (
              <s style={{ marginLeft: 8, color: "#888" }}>{usd(p.priceCents)}</s>
            ) : null}
            <br />
            <span className="card__sats">{sats(p.paySats)} at today&rsquo;s price</span>
          </p>
          {p.description ? <p>{p.description}</p> : null}
          <p className="muted">
            {physical
              ? "Ships from the merchant."
              : "Digital: the merchant sends a link in your order note."}
            {p.inStock ? "" : " Out of stock."}
          </p>
          <AddToCart gid={p.gid} inStock={p.inStock} />
          <div className="text-buy">
            <strong>Text to buy.</strong> In Signal, send Agentic Bitcoin:
            <code>
              buy {p.gid} for {usd(p.payCents)}
              {physical ? " ship to <name>, <street>, <city>, <region>, <postal>, <country>" : ""}
            </code>
            <span className="muted">
              It pays from your wallet after you confirm. <Link href="/text">Not texting yet?</Link>
            </span>
          </div>
        </div>
      </div>
    </ShopShell>
  )
}
