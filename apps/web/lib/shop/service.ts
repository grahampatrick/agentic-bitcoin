/**
 * Storefront service (M12, ADR-0016): catalogue views, checkout (one invoice per merchant, minted by
 * the merchant's wallet), order status with settlement, and the merchant's product/order tools.
 * Shipping is sealed with SECRETS_KEY the moment it arrives; only a merchant's dashboard can open it.
 */
import {
  type OrderStore,
  PRODUCT_ID_RE,
  type PriceSnapshot,
  type ProductStore,
  type Recipient,
  SHOP_CATEGORIES,
  type ShopCategory,
  type ShopOrder,
  type ShopOrderItem,
  type ShopProduct,
  effectivePriceCents,
  preimageMatches,
  satsForCents,
} from "@agentic-bitcoin/core"
import {
  DirectoryGoodsRail,
  NwcWalletRail,
  decryptSecret,
  encryptSecret,
  parseKey,
} from "@agentic-bitcoin/rails"
import { hashToken } from "../receive/service"
import type { ReceiveStore } from "../receive/store"

export interface ShopDeps {
  products: ProductStore
  orders: OrderStore
  receive: ReceiveStore
  price(): Promise<PriceSnapshot | undefined>
  baseUrl: string
  secretsKey?: Buffer | null
  fetchImpl?: typeof fetch
  now?: () => Date
  walletFor?: ConstructorParameters<typeof DirectoryGoodsRail>[0]["walletFor"]
}
const key = (d: ShopDeps) =>
  d.secretsKey === undefined
    ? process.env.SECRETS_KEY
      ? parseKey(process.env.SECRETS_KEY)
      : null
    : d.secretsKey

export interface Shipping {
  name: string
  address: string
  city: string
  region?: string
  postal?: string
  country: string
}

/** What a page may show. Prices in cents plus sats at the current price. */
export interface ProductView extends Omit<ShopProduct, "priceCents" | "dealCents"> {
  gid: string
  priceCents: number
  dealCents?: number
  payCents: number
  paySats?: number
  saveCents?: number
  merchantName: string
  url: string
}

export async function viewProducts(
  deps: ShopDeps,
  products: readonly ShopProduct[],
): Promise<ProductView[]> {
  const price = await deps.price()
  const merchants = new Map<string, Recipient | null>()
  const out: ProductView[] = []
  for (const p of products) {
    if (!merchants.has(p.merchantSlug))
      merchants.set(p.merchantSlug, await deps.receive.getRecipient(p.merchantSlug))
    const m = merchants.get(p.merchantSlug)
    if (!m || !m.verified) continue // unverified merchants are not listed
    const pay = effectivePriceCents(p)
    out.push({
      ...p,
      gid: `dir:${p.merchantSlug}:${p.id}`,
      priceCents: Number(p.priceCents),
      dealCents: p.dealCents === undefined ? undefined : Number(p.dealCents),
      payCents: Number(pay),
      paySats: price ? Number(satsForCents(pay, price)) : undefined,
      saveCents:
        p.dealCents !== undefined && p.dealCents < p.priceCents
          ? Number(p.priceCents - p.dealCents)
          : undefined,
      merchantName: m.name,
      url: `${deps.baseUrl}/shop/p/${p.merchantSlug}/${p.id}`,
    })
  }
  return out
}

export interface MerchantView {
  slug: string
  name: string
  description?: string
  website?: string
  country?: string
  productCount: number
}

export async function listMerchants(deps: ShopDeps): Promise<MerchantView[]> {
  const all = await deps.products.search("", { limit: 1000 })
  const bySlug = new Map<string, number>()
  for (const p of all) bySlug.set(p.merchantSlug, (bySlug.get(p.merchantSlug) ?? 0) + 1)
  const out: MerchantView[] = []
  for (const [slug, n] of bySlug) {
    const m = await deps.receive.getRecipient(slug)
    if (m?.verified)
      out.push({
        slug,
        name: m.name,
        description: m.description,
        website: m.website,
        country: m.country,
        productCount: n,
      })
  }
  return out.sort((a, b) => b.productCount - a.productCount)
}

export async function categoriesWithCounts(
  deps: ShopDeps,
): Promise<{ category: ShopCategory; count: number }[]> {
  const all = await deps.products.search("", { limit: 1000 })
  const counts = new Map<ShopCategory, number>()
  for (const p of all) counts.set(p.category, (counts.get(p.category) ?? 0) + 1)
  return SHOP_CATEGORIES.filter((c) => counts.has(c)).map((c) => ({
    category: c,
    count: counts.get(c) ?? 0,
  }))
}

// --- checkout -----------------------------------------------------------------------------------

export interface CheckoutInput {
  merchantSlug: string
  items: { productId: string; qty: number }[]
  shipping?: Partial<Shipping>
  contact?: string
  buyerKey?: string
}
export type CheckoutResult =
  | {
      ok: true
      orderId: string
      bolt11: string
      paymentHash: string
      totalCents: number
      totalSats: number
      expiresInSeconds: number
    }
  | { ok: false; error: string }

function rail(deps: ShopDeps, buyerKey?: string): DirectoryGoodsRail {
  return new DirectoryGoodsRail({
    products: deps.products,
    orders: deps.orders,
    merchant: (slug) => deps.receive.getRecipient(slug),
    price: deps.price,
    secretsKey: key(deps),
    walletFor: deps.walletFor ?? ((cs) => new NwcWalletRail({ connectionString: cs })),
    fetchImpl: deps.fetchImpl,
    now: deps.now,
    siteUrl: deps.baseUrl,
    buyerKey,
  })
}

export async function checkout(deps: ShopDeps, input: CheckoutInput): Promise<CheckoutResult> {
  const lines = Array.isArray(input.items) ? input.items.slice(0, 50) : []
  if (!lines.length) return { ok: false, error: "Your cart is empty." }
  const items: ShopOrderItem[] = []
  for (const l of lines) {
    const qty = Math.floor(Number(l.qty))
    if (!Number.isInteger(qty) || qty < 1 || qty > 99)
      return { ok: false, error: "Quantities must be 1–99." }
    if (!PRODUCT_ID_RE.test(String(l.productId))) return { ok: false, error: "Bad product." }
    const p = await deps.products.get(input.merchantSlug, l.productId)
    if (!p || !p.inStock) return { ok: false, error: `"${l.productId}" is not available.` }
    items.push({
      productId: p.id,
      title: p.title,
      qty,
      priceCents: effectivePriceCents(p),
      kind: p.kind,
    })
  }
  const needsShipping = items.some((i) => i.kind === "physical")
  let shippingSealed: string | undefined
  let contactSealed: string | undefined
  const k = key(deps)
  if (needsShipping) {
    const s = input.shipping ?? {}
    const clean = (v: unknown) =>
      String(v ?? "")
        .trim()
        .slice(0, 120)
    const ship: Shipping = {
      name: clean(s.name),
      address: clean(s.address),
      city: clean(s.city),
      region: clean(s.region) || undefined,
      postal: clean(s.postal) || undefined,
      country: clean(s.country).toUpperCase().slice(0, 2),
    }
    if (!ship.name || !ship.address || !ship.city || ship.country.length !== 2)
      return { ok: false, error: "Shipping needs a name, street, city and country." }
    if (!k)
      return { ok: false, error: "This server cannot store shipping details yet (no SECRETS_KEY)." }
    shippingSealed = encryptSecret(JSON.stringify(ship), k)
  }
  const contact = String(input.contact ?? "")
    .trim()
    .slice(0, 120)
  if (contact) {
    if (!k)
      return { ok: false, error: "This server cannot store contact details yet (no SECRETS_KEY)." }
    contactSealed = encryptSecret(contact, k)
  }
  try {
    const o = await rail(deps, input.buyerKey).createCartOrder({
      merchantSlug: input.merchantSlug,
      items,
      shippingSealed,
      contactSealed,
      buyerKey: input.buyerKey,
    })
    return {
      ok: true,
      orderId: o.id,
      bolt11: o.bolt11,
      paymentHash: o.paymentHash,
      totalCents: Number(o.totalCents),
      totalSats: Number(o.totalSats),
      expiresInSeconds: 600,
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

// --- order status -------------------------------------------------------------------------------

export interface OrderView {
  id: string
  merchantSlug: string
  merchantName: string
  items: { productId: string; title: string; qty: number; priceCents: number; kind: string }[]
  totalCents: number
  totalSats: number
  state: ShopOrder["state"]
  bolt11: string
  paymentHash: string
  createdAt: string
  paidAt?: string
  fulfilledAt?: string
  note?: string
  /** True when we can observe settlement ourselves (merchant wallet connected). */
  canVerify: boolean
  hasShipping: boolean
}

export async function orderStatus(deps: ShopDeps, id: string): Promise<OrderView | null> {
  let o = await deps.orders.get(id)
  if (!o) return null
  const m = await deps.receive.getRecipient(o.merchantSlug)
  const k = key(deps)
  const canVerify = !!(m?.nwcReceive && k)
  if (o.state === "unpaid" && canVerify && m?.nwcReceive && k) {
    const wallet = (
      deps.walletFor ?? ((cs: string) => new NwcWalletRail({ connectionString: cs }))
    )(decryptSecret(m.nwcReceive, k)) as {
      lookupInvoice?(h: string): Promise<{ state: string; preimage?: string; settledAt?: string }>
      close?(): void
    }
    try {
      const look = await wallet.lookupInvoice?.(o.paymentHash)
      if (look?.state === "settled") {
        o = {
          ...o,
          state: "paid",
          preimage: look.preimage,
          paidAt: look.settledAt ?? (deps.now ?? (() => new Date()))().toISOString(),
        }
        await deps.orders.update(o)
      }
    } catch {
      /* the merchant's wallet app remains the record */
    } finally {
      wallet.close?.()
    }
  }
  return {
    id: o.id,
    merchantSlug: o.merchantSlug,
    merchantName: m?.name ?? o.merchantSlug,
    items: o.items.map((i) => ({ ...i, priceCents: Number(i.priceCents) })),
    totalCents: Number(o.totalCents),
    totalSats: Number(o.totalSats),
    state: o.state,
    bolt11: o.bolt11,
    paymentHash: o.paymentHash,
    createdAt: o.createdAt,
    paidAt: o.paidAt,
    fulfilledAt: o.fulfilledAt,
    note: o.note,
    canVerify,
    hasShipping: !!o.shippingSealed,
  }
}

/** The buyer proves payment with the preimage their wallet shows; sha256 must match the invoice hash. */
export async function claimPaid(
  deps: ShopDeps,
  id: string,
  preimage: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const o = await deps.orders.get(id)
  if (!o) return { ok: false, error: "No such order." }
  if (o.state !== "unpaid") return { ok: true }
  if (!preimageMatches(preimage.trim(), o.paymentHash))
    return { ok: false, error: "That preimage does not match this invoice." }
  await deps.orders.update({
    ...o,
    state: "paid",
    preimage: preimage.trim().toLowerCase(),
    paidAt: (deps.now ?? (() => new Date()))().toISOString(),
  })
  return { ok: true }
}

// --- merchant tools (dashboard token) -------------------------------------------------------------

async function merchantAuthed(deps: ShopDeps, slug: string, token: string) {
  const r = await deps.receive.getRecipient(slug)
  if (
    !r ||
    r.kind !== "merchant" ||
    !r.dashboardTokenHash ||
    !token ||
    hashToken(token) !== r.dashboardTokenHash
  )
    return null
  return r
}

export interface ProductForm {
  id?: string
  title: string
  description?: string
  imageUrl?: string
  category: string
  /** Dollars as typed, e.g. "39.99". */
  price: string
  deal?: string
  kind: "digital" | "physical"
  inStock?: boolean
}

const cents = (s: string | undefined): bigint | null => {
  const t = (s ?? "").replace(/[$,\s]/g, "")
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  const [d, c = ""] = t.split(".")
  return BigInt(d ?? "0") * 100n + BigInt(c.padEnd(2, "0"))
}

export async function upsertProduct(
  deps: ShopDeps,
  slug: string,
  token: string,
  form: ProductForm,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const m = await merchantAuthed(deps, slug, token)
  if (!m) return { ok: false, error: "Not authorized." }
  const title = (form.title ?? "").trim().slice(0, 120)
  if (title.length < 2) return { ok: false, error: "Give the product a title." }
  const id = (
    form.id?.trim() ||
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  ).slice(0, 63)
  if (!PRODUCT_ID_RE.test(id)) return { ok: false, error: "That title does not make a usable id." }
  if (!SHOP_CATEGORIES.includes(form.category as ShopCategory))
    return { ok: false, error: "Pick a category." }
  const price = cents(form.price)
  if (price === null || price < 1n) return { ok: false, error: "Enter a price in dollars." }
  const deal = form.deal?.trim() ? cents(form.deal) : undefined
  if (deal === null) return { ok: false, error: "The deal price is not a number." }
  let imageUrl: string | undefined
  if (form.imageUrl?.trim()) {
    try {
      const u = new URL(form.imageUrl.trim())
      if (u.protocol !== "https:") throw new Error()
      imageUrl = u.toString()
    } catch {
      return { ok: false, error: "Image must be an https:// link." }
    }
  }
  await deps.products.upsert({
    id,
    merchantSlug: m.slug,
    title,
    description: form.description?.trim().slice(0, 1000) || undefined,
    imageUrl,
    category: form.category as ShopCategory,
    priceCents: price,
    dealCents: deal,
    kind: form.kind === "digital" ? "digital" : "physical",
    inStock: form.inStock !== false,
  })
  return { ok: true, id }
}

export async function removeProduct(deps: ShopDeps, slug: string, token: string, id: string) {
  const m = await merchantAuthed(deps, slug, token)
  if (!m) return { ok: false as const, error: "Not authorized." }
  await deps.products.remove(m.slug, id)
  return { ok: true as const }
}

export interface MerchantOrderView extends OrderView {
  shipping?: Shipping
  contact?: string
}

/** The merchant's orders, with shipping and contact decrypted for them alone. */
export async function merchantOrders(
  deps: ShopDeps,
  slug: string,
  token: string,
): Promise<MerchantOrderView[] | null> {
  const m = await merchantAuthed(deps, slug, token)
  if (!m) return null
  const k = key(deps)
  const list = await deps.orders.listForMerchant(m.slug, 100)
  const out: MerchantOrderView[] = []
  for (const o of list) {
    const v = await orderStatus(deps, o.id)
    if (!v) continue
    let shipping: Shipping | undefined
    let contact: string | undefined
    if (k) {
      try {
        if (o.shippingSealed) shipping = JSON.parse(decryptSecret(o.shippingSealed, k)) as Shipping
        if (o.contactSealed) contact = decryptSecret(o.contactSealed, k)
      } catch {
        /* a rotated key: the blob stays sealed */
      }
    }
    out.push({ ...v, shipping, contact })
  }
  return out
}

export async function fulfilOrder(
  deps: ShopDeps,
  slug: string,
  token: string,
  orderId: string,
  note?: string,
) {
  const m = await merchantAuthed(deps, slug, token)
  const o = m ? await deps.orders.get(orderId) : null
  if (!m || !o || o.merchantSlug !== m.slug) return { ok: false as const, error: "Not authorized." }
  if (o.state !== "paid") return { ok: false as const, error: "Only paid orders can be fulfilled." }
  await deps.orders.update({
    ...o,
    state: "fulfilled",
    fulfilledAt: (deps.now ?? (() => new Date()))().toISOString(),
    note: note?.trim().slice(0, 500) || o.note,
  })
  return { ok: true as const }
}

export function shopDeps(
  over: Partial<ShopDeps> & Pick<ShopDeps, "products" | "orders" | "receive" | "price" | "baseUrl">,
): ShopDeps {
  return over
}
