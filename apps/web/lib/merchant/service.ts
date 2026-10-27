/**
 * The merchant portal (M18): one place for a merchant, church or creator — income, orders,
 * transactions, payment links, invoices, POS, store, connections, settings. Everything here is a
 * view over stores that already exist; nothing new is held. Token-gated like the dashboard.
 */
import { getCampaignStore } from "@/lib/campaigns/store"
import { invoiceDepsFor } from "@/lib/invoices/deps"
import { recipientInvoices } from "@/lib/invoices/service"
import { type PriceQuote, getPrice } from "@/lib/price/feed"
import { type PublicRecipient, hashToken, publicView, siteBaseUrl } from "@/lib/receive/service"
import { type ReceiveInvoice, getReceiveStore } from "@/lib/receive/store"
import { shopDepsFor } from "@/lib/shop/deps"
import { type MerchantOrderView, merchantOrders } from "@/lib/shop/service"
import { getProductStore } from "@/lib/shop/store"

export type PortalInvoice = NonNullable<Awaited<ReturnType<typeof recipientInvoices>>>[number]

export interface Portal {
  slug: string
  token: string
  base: string
  recipient: PublicRecipient & {
    walletConnected: boolean
    manifestHost?: string
    submittedAt?: string
    verifiedDetail: { how: string; at: string } | null
  }
  price: PriceQuote | null
  /** Gifts and tips minted by our LNURL endpoint. */
  received: ReceiveInvoice[]
  invoices: PortalInvoice[]
  orders: MerchantOrderView[]
  productCount: number
  campaigns: { slug: string; title: string; active: boolean; goalLabel: string }[]
  income: {
    satsReceived: number
    tipsSats: number
    ordersSats: number
    invoicesSats: number
    payments: number
    usdCents: number | null
  }
}

/** Load everything the portal shows, or null when the token is wrong. */
export async function portalFor(slug: string, token: string): Promise<Portal | null> {
  getProductStore() // keyless demo: seeds the demo merchants (and the demo portal token) on first use
  const receive = getReceiveStore()
  const r = await receive.getRecipient(slug.toLowerCase())
  if (!r || !r.dashboardTokenHash || !token || hashToken(token) !== r.dashboardTokenHash)
    return null
  const base = siteBaseUrl()
  const [received, invoices, orders, products, campaigns, price] = await Promise.all([
    receive.listInvoices(r.slug, 200),
    recipientInvoices(invoiceDepsFor(), r.slug, token).then((x) => x ?? []),
    r.kind === "merchant"
      ? merchantOrders(shopDepsFor(), r.slug, token).then((x) => x ?? [])
      : Promise.resolve([]),
    r.kind === "merchant" ? getProductStore().listForMerchant(r.slug) : Promise.resolve([]),
    getCampaignStore().listForRecipient(r.slug),
    getPrice().catch(() => null),
  ])
  const tipsSats = received
    .filter((i) => i.settledAt)
    .reduce((a, i) => a + Math.floor(i.amountMsats / 1000), 0)
  const ordersSats = orders
    .filter((o) => o.state === "paid" || o.state === "fulfilled")
    .reduce((a, o) => a + o.totalSats, 0)
  const invoicesSats = invoices
    .filter((i) => i.status === "paid")
    .reduce((a, i) => a + (i.amountSats ?? 0), 0)
  const satsReceived = tipsSats + ordersSats + invoicesSats
  const payments =
    received.filter((i) => i.settledAt).length +
    orders.filter((o) => o.state === "paid" || o.state === "fulfilled").length +
    invoices.filter((i) => i.status === "paid").length
  return {
    slug: r.slug,
    token,
    base,
    recipient: {
      ...publicView(r, base),
      walletConnected: !!r.nwcReceive,
      manifestHost: r.manifestHost,
      submittedAt: r.submittedAt,
      verifiedDetail: r.verified,
    },
    price,
    received,
    invoices,
    orders,
    productCount: products.length,
    campaigns: campaigns.map((c) => ({
      slug: c.slug,
      title: c.title,
      active: c.active,
      goalLabel:
        "satsTotal" in c.goal
          ? `${c.goal.satsTotal.toLocaleString("en-US")} sats`
          : `$${(c.goal.usdCentsPerMonth / 100n).toString()}/month`, // money-ok: label
    })),
    income: {
      satsReceived,
      tipsSats,
      ordersSats,
      invoicesSats,
      payments,
      usdCents: price ? Math.round((satsReceived / price.satsPerDollar) * 100) : null, // money-ok: display estimate at today's price
    },
  }
}

export const fmtSats = (n: number) => `${n.toLocaleString("en-US")} sats` // money-ok: display
export const fmtUsd = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` // money-ok: display
export const fmtDate = (iso?: string) => (iso ? iso.slice(0, 10) : "—")
