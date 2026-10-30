import type { Portal } from "@/lib/merchant/service"
import Link from "next/link"
import { Icon } from "./icons"

export const NAV = {
  tools: [
    { key: "links", label: "Payment Links", icon: "link" },
    { key: "tickets", label: "Event Tickets", icon: "ticket" },
    { key: "invoices", label: "Invoices", icon: "invoice" },
    { key: "recurring", label: "Recurring Invoices", icon: "repeat" },
    { key: "requests", label: "Payment Requests", icon: "inbox" },
    { key: "pos", label: "POS", icon: "pos" },
    { key: "checkout", label: "Checkout", icon: "checkout" },
  ],
  business: [
    { key: "orders", label: "Orders", icon: "check" },
    { key: "transactions", label: "Transactions", icon: "bolt" },
    { key: "contacts", label: "Contacts", icon: "contact" },
    { key: "connections", label: "Connections", icon: "plug" },
    { key: "plan", label: "Plan", icon: "repeat" },
    { key: "settings", label: "Settings", icon: "gear" },
  ],
} as const

export function portalHref(p: Pick<Portal, "slug" | "token">, key = "") {
  return `/merchant/${p.slug}${key ? `/${key}` : ""}?t=${encodeURIComponent(p.token)}`
}

export function PortalShell({
  portal,
  active,
  title,
  children,
}: { portal: Portal; active: string; title: string; children: React.ReactNode }) {
  const item = (n: { key: string; label: string; icon: keyof typeof Icon }) => (
    <Link key={n.key} href={portalHref(portal, n.key)} className={active === n.key ? "is-on" : ""}>
      <span className="mp__icon">{Icon[n.icon]()}</span>
      {n.label}
    </Link>
  )
  const price = portal.price
    ? `$${Math.round(portal.price.usdCents / 100).toLocaleString("en-US")}`
    : "—" // money-ok: display
  return (
    <div className="mp">
      <aside className="mp__side">
        <Link href={portalHref(portal)} className="mp__brand">
          <span className="mp__brand-mark">{Icon.bolt()}</span>
          <span className="mp__brand-name">{portal.recipient.name}</span>
        </Link>
        <nav className="mp__nav" aria-label="Portal">
          <Link
            href={portalHref(portal)}
            className={`mp__home${active === "home" ? " is-on" : ""}`}
          >
            <span className="mp__icon">{Icon.home()}</span>
            Home
          </Link>
          <p className="mp__group">Merchant tools</p>
          {NAV.tools.map(item)}
          <p className="mp__group">Your business</p>
          {NAV.business.map(item)}
          <p className="mp__group">Help &amp; support</p>
          <a href="/text" className="">
            <span className="mp__icon">{Icon.help()}</span>
            Support <span className="mp__ext">↗</span>
          </a>
        </nav>
        <Link href="/" className="mp__foot">
          Agentic Bitcoin
        </Link>
      </aside>
      <div className="mp__main">
        <header className="mp__top">
          <span className="mp__crumb">{title}</span>
          <span className="mp__top-right">
            <span className="mp__price">
              <span className="mp__btc">₿</span> {price}
            </span>
            <Link
              href={portalHref(portal, "pos")}
              className="mp__plus"
              aria-label="New sale"
              title="New sale"
            >
              +
            </Link>
            <Link
              href={`/give/${portal.slug}`}
              className="mp__round"
              aria-label="Your public page"
              title="Your public page"
            >
              {Icon.contact()}
            </Link>
          </span>
        </header>
        <main className="mp__content">{children}</main>
      </div>
    </div>
  )
}

export function Panel({
  title,
  action,
  children,
  wide,
}: { title: string; action?: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  return (
    <section className={`mp__panel${wide ? " mp__panel--wide" : ""}`}>
      <header className="mp__panel-head">
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  )
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mp__empty">
      <p className="mp__empty-title">{title}</p>
      {children}
    </div>
  )
}

export function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="mp__rows">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}
