import { ShopShell } from "@/components/shop/ShopShell"
import { shopDepsFor } from "@/lib/shop/deps"
import { categoriesWithCounts, listMerchants } from "@/lib/shop/service"
import Link from "next/link"

export const dynamic = "force-dynamic"

export default async function Categories() {
  const deps = shopDepsFor()
  const [cats, merchants] = await Promise.all([categoriesWithCounts(deps), listMerchants(deps)])
  return (
    <ShopShell active="categories">
      <h1 style={{ fontSize: 28 }}>Categories</h1>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
        {cats.map((c) => (
          <li key={c.category}>
            <Link href={`/shop/c/${c.category}`}>
              <strong style={{ textTransform: "capitalize" }}>
                {c.category.replace("-", " ")}
              </strong>{" "}
              <span className="muted">{c.count}</span>
            </Link>
          </li>
        ))}
      </ul>
      <h2 style={{ fontSize: 22, marginTop: 32 }}>Merchants</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
        {merchants.map((m) => (
          <li key={m.slug}>
            <Link href={`/shop/m/${m.slug}`}>
              <strong>{m.name}</strong> <span className="muted">{m.productCount} products</span>
            </Link>
          </li>
        ))}
      </ul>
    </ShopShell>
  )
}
