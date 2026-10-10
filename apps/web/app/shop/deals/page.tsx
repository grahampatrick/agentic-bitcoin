import { ProductCard } from "@/components/shop/ProductCard"
import { ShopShell } from "@/components/shop/ShopShell"
import { shopDepsFor } from "@/lib/shop/deps"
import { viewProducts } from "@/lib/shop/service"

export const dynamic = "force-dynamic"

export default async function Page() {
  const deps = shopDepsFor()
  const items = await viewProducts(deps, await deps.products.deals(60))
  return (
    <ShopShell active="deals">
      <h1 style={{ fontSize: 28 }}>Deals for you</h1>

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
