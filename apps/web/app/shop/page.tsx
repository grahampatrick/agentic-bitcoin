import { ProductCard, usd } from "@/components/shop/ProductCard"
import { ShopShell } from "@/components/shop/ShopShell"
import { shopDepsFor } from "@/lib/shop/deps"
import { categoriesWithCounts, listMerchants, viewProducts } from "@/lib/shop/service"
import { isDemoCatalogue } from "@/lib/shop/store"
import Link from "next/link"

export const dynamic = "force-dynamic"

const LABEL: Record<string, string> = {
  books: "Books",
  apparel: "Apparel",
  "gift-cards": "Gift cards",
  home: "Home",
  kids: "Kids",
  sports: "Sports",
  food: "Food",
  art: "Art",
  electronics: "Electronics",
  other: "More",
}
const hue = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7)

export default async function ShopHome() {
  const deps = shopDepsFor()
  const [cats, merchants, deals] = await Promise.all([
    categoriesWithCounts(deps),
    listMerchants(deps),
    deps.products.deals(12),
  ])
  const featured = merchants[0]
  const featuredProducts = featured
    ? await viewProducts(
        deps,
        (await deps.products.listForMerchant(featured.slug)).filter((p) => p.inStock).slice(0, 4),
      )
    : []
  const dealViews = await viewProducts(deps, deals)
  return (
    <ShopShell active="home">
      {isDemoCatalogue() ? (
        <p className="demo-note">
          Demo catalogue: fictional merchants and products, so you can see how the store works
          before real merchants list here.
        </p>
      ) : null}
      <div className="shop__chips">
        {cats.map((c) => (
          <Link key={c.category} href={`/shop/c/${c.category}`} className="shop__chip">
            <span
              className="shop__chip-dot"
              style={{ background: `hsl(${hue(c.category)} 70% 55%)` }}
            >
              {LABEL[c.category]?.[0]}
            </span>
            {LABEL[c.category] ?? c.category}
          </Link>
        ))}
      </div>
      {featured ? (
        <section
          className="hero"
          style={{
            background: `linear-gradient(135deg, hsl(${hue(featured.slug)} 35% 28%), hsl(${(hue(featured.slug) + 40) % 360} 30% 18%))`,
          }}
        >
          <div className="hero__meta">
            <h2>{featured.name}</h2>
            <p>
              {featured.productCount} products{featured.country ? ` · ${featured.country}` : ""}
            </p>
          </div>
          <div>
            <div className="hero__brand">{featured.name[0]}</div>
            <Link href={`/shop/m/${featured.slug}`} className="hero__cta">
              Shop all
            </Link>
          </div>
          <div className="hero__tiles">
            {featuredProducts.map((p) => (
              <Link key={p.gid} href={`/shop/p/${p.merchantSlug}/${p.id}`} className="tile">
                {p.imageUrl ? <img src={p.imageUrl} alt="" /> : <span>{p.title}</span>}
                <span className="price-pill">{usd(p.payCents)}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <p className="muted">
          No merchants yet. <Link href="/receive">Open a store.</Link>
        </p>
      )}
      {dealViews.length ? (
        <section className="row">
          <h2>
            <Link href="/shop/deals">Deals for you ›</Link>
          </h2>
          <div className="cards--scroll">
            {dealViews.map((p) => (
              <ProductCard key={p.gid} p={p} />
            ))}
          </div>
        </section>
      ) : null}
      {merchants.slice(1).map((m) => (
        <MerchantRow key={m.slug} slug={m.slug} name={m.name} />
      ))}
      <p className="muted" style={{ marginTop: 40 }}>
        Every price is paid in sats from your wallet; every invoice is created by the
        merchant&rsquo;s own wallet. Agentic Bitcoin never holds the money. Prefer texting?{" "}
        <Link href="/text">Text “find me a study bible”.</Link> Selling?{" "}
        <Link href="/receive">Open a store.</Link>
      </p>
    </ShopShell>
  )
}

async function MerchantRow({ slug, name }: { slug: string; name: string }) {
  const deps = shopDepsFor()
  const items = await viewProducts(
    deps,
    (await deps.products.listForMerchant(slug)).filter((p) => p.inStock).slice(0, 8),
  )
  if (!items.length) return null
  return (
    <section className="row">
      <h2>
        <Link href={`/shop/m/${slug}`}>{name} ›</Link>
      </h2>
      <div className="cards--scroll">
        {items.map((p) => (
          <ProductCard key={p.gid} p={p} />
        ))}
      </div>
    </section>
  )
}
