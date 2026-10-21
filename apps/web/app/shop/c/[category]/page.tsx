import { ProductCard } from "@/components/shop/ProductCard"
import { ShopShell } from "@/components/shop/ShopShell"
import { shopDepsFor } from "@/lib/shop/deps"
import { viewProducts } from "@/lib/shop/service"
import { SHOP_CATEGORIES, type ShopCategory } from "@agentic-bitcoin/core"
import Link from "next/link"
import { notFound } from "next/navigation"

export const dynamic = "force-dynamic"

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ category: string }>
  searchParams: Promise<{ game?: string; set?: string; condition?: string; q?: string }>
}) {
  const { category } = await params
  const sp = await searchParams
  if (!SHOP_CATEGORIES.includes(category as ShopCategory)) notFound()
  const deps = shopDepsFor()
  const all = await deps.products.search(sp.q ?? "", {
    category: category as ShopCategory,
    limit: 500,
  })
  const games = [...new Set(all.map((p) => p.tcg?.game).filter(Boolean) as string[])].sort()
  const sets = [
    ...new Set(
      all
        .filter((p) => !sp.game || p.tcg?.game === sp.game)
        .map((p) => p.tcg?.set)
        .filter(Boolean) as string[],
    ),
  ].sort()
  const conditions = [
    ...new Set(all.map((p) => p.tcg?.condition).filter(Boolean) as string[]),
  ].sort()
  const filtered = all.filter(
    (p) =>
      (!sp.game || p.tcg?.game === sp.game) &&
      (!sp.set || p.tcg?.set === sp.set) &&
      (!sp.condition || p.tcg?.condition === sp.condition),
  )
  const items = await viewProducts(deps, filtered.slice(0, 120))
  const link = (over: Record<string, string | undefined>) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...sp, ...over })) if (v) q.set(k, v)
    const s = q.toString()
    return `/shop/c/${category}${s ? `?${s}` : ""}`
  }
  return (
    <ShopShell active="categories" query={sp.q}>
      <h1 style={{ fontSize: 28, textTransform: "capitalize" }}>
        {category === "tcg" ? "Cards" : category.replace("-", " ")}
      </h1>
      {category === "tcg" && games.length ? (
        <div className="shop__chips" style={{ justifyContent: "flex-start", gap: 12 }}>
          <Link href={link({ game: undefined, set: undefined })} className="demo__cancel">
            All games
          </Link>
          {games.map((g) => (
            <Link
              key={g}
              href={link({ game: g, set: undefined })}
              className={`demo__cancel${sp.game === g ? " is-on" : ""}`}
              style={{ textTransform: "capitalize" }}
            >
              {g}
            </Link>
          ))}
        </div>
      ) : null}
      {category === "tcg" && sets.length > 1 ? (
        <p className="muted">
          Set:{" "}
          {sets.slice(0, 30).map((s) => (
            <Link
              key={s}
              href={link({ set: sp.set === s ? undefined : s })}
              style={{ marginRight: 10, fontWeight: sp.set === s ? 700 : 400 }}
            >
              {s}
            </Link>
          ))}
        </p>
      ) : null}
      {category === "tcg" && conditions.length > 1 ? (
        <p className="muted">
          Condition:{" "}
          {conditions.map((c) => (
            <Link
              key={c}
              href={link({ condition: sp.condition === c ? undefined : c })}
              style={{ marginRight: 10, fontWeight: sp.condition === c ? 700 : 400 }}
            >
              {c}
            </Link>
          ))}
        </p>
      ) : null}
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
