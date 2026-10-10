import { ProductCard } from "@/components/shop/ProductCard"
import { ShopShell } from "@/components/shop/ShopShell"
import { shopDepsFor } from "@/lib/shop/deps"
import { viewProducts } from "@/lib/shop/service"
import { notFound } from "next/navigation"

export const dynamic = "force-dynamic"

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const deps = shopDepsFor()
  const { slug } = await params
  const m = await deps.receive.getRecipient(slug)
  if (!m || m.kind !== "merchant" || !m.verified) notFound()
  const items = await viewProducts(
    deps,
    (await deps.products.listForMerchant(slug)).filter((p) => p.inStock),
  )
  return (
    <ShopShell active="home">
      <h1 style={{ fontSize: 28 }}>{m.name}</h1>
      {m.description ? <p className="muted">{m.description}</p> : null}
      {items.length ? (
        <div className="cards">
          {items.map((p) => (
            <ProductCard key={p.gid} p={p} />
          ))}
        </div>
      ) : (
        <p className="muted">Nothing here yet.</p>
      )}
    </ShopShell>
  )
}
