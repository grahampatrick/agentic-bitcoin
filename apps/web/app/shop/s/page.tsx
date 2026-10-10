import { ProductCard } from "@/components/shop/ProductCard"
import { ShopShell } from "@/components/shop/ShopShell"
import { shopDepsFor } from "@/lib/shop/deps"
import { viewProducts } from "@/lib/shop/service"

export const dynamic = "force-dynamic"

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const deps = shopDepsFor()
  const { q = "" } = await searchParams
  const items = await viewProducts(deps, await deps.products.search(q, { limit: 60 }))
  return (
    <ShopShell active="home" query={q}>
      <h1 style={{ fontSize: 28 }}>{q ? `Results for “${q}”` : "Everything"}</h1>

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
