import { ProductCard } from "@/components/shop/ProductCard"
import { ShopShell } from "@/components/shop/ShopShell"
import { shopDepsFor } from "@/lib/shop/deps"
import { viewProducts } from "@/lib/shop/service"
import { SHOP_CATEGORIES, type ShopCategory } from "@agentic-bitcoin/core"
import { notFound } from "next/navigation"

export const dynamic = "force-dynamic"

export default async function Page({ params }: { params: Promise<{ category: string }> }) {
  const deps = shopDepsFor()
  const { category } = await params
  if (!SHOP_CATEGORIES.includes(category as ShopCategory)) notFound()
  const items = await viewProducts(
    deps,
    await deps.products.search("", { category: category as ShopCategory, limit: 60 }),
  )
  return (
    <ShopShell active="categories">
      <h1 style={{ fontSize: 28 }}>{category.replace("-", " ")}</h1>

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
