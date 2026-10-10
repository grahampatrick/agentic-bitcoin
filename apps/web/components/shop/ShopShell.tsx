import Link from "next/link"
import { CartBadge } from "./CartBadge"
import { Icon } from "./icons"

export function ShopShell({
  children,
  active,
  query,
}: { children: React.ReactNode; active?: string; query?: string }) {
  const item = (
    href: string,
    key: string,
    label: string,
    icon: React.ReactNode,
    badge?: React.ReactNode,
  ) => (
    <Link href={href} className={active === key ? "is-on" : ""} aria-label={label} title={label}>
      {icon}
      {badge}
    </Link>
  )
  return (
    <div className="shop">
      <nav className="shop__rail" aria-label="Store">
        <Link
          href="/"
          aria-label="Agentic Bitcoin home"
          title="Agentic Bitcoin"
          style={{ color: "#f7931a" }}
        >
          <Icon.bolt />
        </Link>
        <span className="shop__rail-spacer" style={{ flex: 0, height: 24 }} />
        {item("/shop", "home", "Home", <Icon.home />)}
        {item("/shop/c", "categories", "Categories", <Icon.grid />)}
        {item("/shop/cart", "cart", "Cart", <Icon.cart />, <CartBadge />)}
        {item("/shop/deals", "deals", "Deals", <Icon.tag />)}
        {item("/shop/orders", "orders", "Orders", <Icon.bag />)}
        <span className="shop__rail-spacer" />
      </nav>
      <main className="shop__main">
        <div className="shop__search">
          <form action="/shop/s" method="get">
            <Icon.search />
            <input
              name="q"
              defaultValue={query ?? ""}
              placeholder="What are you shopping for today?"
              aria-label="Search the store"
            />
          </form>
        </div>
        {children}
      </main>
    </div>
  )
}
