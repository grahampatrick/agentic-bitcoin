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
  type RewardSink,
  type RewardStore,
  SHOP_CATEGORIES,
  type ShopCategory,
  type ShopOrder,
  type ShopOrderItem,
  type ShopProduct,
  effectivePriceCents,
  isLightningAddress,
  preimageMatches,
  satsForCents,
  summarizeRewards,
} from "@agentic-bitcoin/core"
import {
  type ImportReport,
  type MerchantManifest,
  importProductsCsv,
  importShopifyProducts,
  orderTotalCents,
} from "@agentic-bitcoin/core"
import {
  DirectoryGoodsRail,
  NwcWalletRail,
  RemoteMerchantRail,
  decryptSecret,
  encryptSecret,
  fetchManifest,
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
  /** M13: sats-back accrual on paid orders, and the public lookup. */
  rewards?: RewardSink
  rewardStore?: RewardStore
  /** M24: the shop plan. Unset = every verified merchant may sell. */
  maySell?: (m: Recipient) => Promise<boolean>
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
  /** M16: the product lives on a remote shop (checkout goes to them). */
  remote?: boolean
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
    if (deps.maySell && !(await deps.maySell(m))) continue // lapsed plan (M24)
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
      remote: !!m.manifestHost,
    })
  }
  return out
}

// --- remote shops (M16) ---------------------------------------------------------------------------

type ManifestCache = Map<string, { at: number; m: MerchantManifest }>
const g = globalThis as { __anvardManifests?: ManifestCache }
if (!g.__anvardManifests) g.__anvardManifests = new Map()
const manifests: ManifestCache = g.__anvardManifests

export async function manifestFor(deps: ShopDeps, host: string): Promise<MerchantManifest> {
  const hit = manifests.get(host)
  const now = (deps.now ?? (() => new Date()))().getTime()
  if (hit && now - hit.at < 10 * 60_000) return hit.m
  const m = await fetchManifest(host, (deps.fetchImpl ?? fetch) as never)
  manifests.set(host, { at: now, m })
  return m
}

export async function remoteRailFor(
  deps: ShopDeps,
  r: Recipient,
  buyerRef?: string,
): Promise<RemoteMerchantRail | null> {
  if (!r.manifestHost) return null
  const m = await manifestFor(deps, r.manifestHost)
  return new RemoteMerchantRail({
    manifest: m,
    price: deps.price,
    fetchImpl: deps.fetchImpl as never,
    now: deps.now,
    siteUrl: deps.baseUrl,
    buyerRef,
  })
}

/** Pull a remote shop's feed into our catalogue (replace its products). Returns how many. */
export async function syncRemoteShop(
  deps: ShopDeps,
  slug: string,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const r = await deps.receive.getRecipient(slug)
  if (!r?.manifestHost) return { ok: false, error: "not a remote shop" }
  try {
    const rail = await remoteRailFor(deps, r)
    const products = rail ? await rail.products() : []
    const existing = await deps.products.listForMerchant(slug)
    const keep = new Set(products.map((p) => p.id))
    for (const p of products) await deps.products.upsert({ ...p, merchantSlug: slug })
    for (const e of existing) if (!keep.has(e.id)) await deps.products.remove(slug, e.id)
    return { ok: true, count: products.length }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/** Our side of the protocol: a directory merchant's feed, served to any agent. */
export async function feedFor(deps: ShopDeps, slug: string) {
  const r = await deps.receive.getRecipient(slug)
  if (!r || r.kind !== "merchant" || !r.verified) return null
  const products = await deps.products.listForMerchant(slug)
  return {
    anvard: "0.1" as const,
    merchant: slug,
    updatedAt: (deps.now ?? (() => new Date()))().toISOString(),
    products: products.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      imageUrl: p.imageUrl,
      category: p.category,
      priceCents: Number(p.priceCents),
      dealCents: p.dealCents === undefined ? undefined : Number(p.dealCents),
      kind: p.kind,
      inStock: p.inStock,
      shipsTo: p.shipsTo,
      tcg: p.tcg,
    })),
  }
}

export async function manifestOf(deps: ShopDeps, slug: string): Promise<MerchantManifest | null> {
  const r = await deps.receive.getRecipient(slug)
  if (!r || r.kind !== "merchant" || !r.verified) return null
  const b = deps.baseUrl.replace(/\/$/, "")
  return {
    anvard: "0.1",
    merchant: {
      slug,
      name: r.name,
      website: r.website,
      country: r.country,
      description: r.description,
      lightningAddress: r.lightningAddress,
    },
    endpoints: {
      products: `${b}/api/commerce/${slug}/products`,
      checkout: `${b}/api/commerce/${slug}/checkout`,
      order: `${b}/api/commerce/orders/{id}`,
    },
  }
}

// --- merchant imports (M16) ----------------------------------------------------------------------

export async function importForMerchant(
  deps: ShopDeps,
  slug: string,
  token: string,
  input: {
    csv?: string
    shopifyUrl?: string
    manifestHost?: string
    defaultGame?: string
    replace?: boolean
  },
): Promise<
  | { ok: true; imported: number; skipped: ImportReport["skipped"]; remote?: boolean }
  | { ok: false; error: string }
> {
  const m = await merchantAuthed(deps, slug, token)
  if (!m) return { ok: false, error: "Not authorized." }
  let report: ImportReport | null = null
  if (input.manifestHost?.trim()) {
    const host = input.manifestHost
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
    try {
      const man = await manifestFor(deps, host)
      if (man.merchant.slug !== slug)
        return {
          ok: false,
          error: `That shop's manifest says its slug is "${man.merchant.slug}", not "${slug}".`,
        }
    } catch (err) {
      return {
        ok: false,
        error: `Could not read https://${host}/.well-known/anvard.json: ${(err as Error).message}`,
      }
    }
    await deps.receive.setManifestHost(slug, host)
    const r = await syncRemoteShop(deps, slug)
    return r.ok
      ? { ok: true, imported: r.count, skipped: [], remote: true }
      : { ok: false, error: r.error }
  }
  if (input.csv)
    report = importProductsCsv(input.csv.slice(0, 5_000_000), slug, {
      defaultGame: input.defaultGame,
    })
  else if (input.shopifyUrl?.trim()) {
    let url: URL
    try {
      url = new URL(input.shopifyUrl.trim())
      if (url.protocol !== "https:") throw new Error()
    } catch {
      return { ok: false, error: "The Shopify link must be https://" }
    }
    const feed = url.pathname.endsWith("products.json")
      ? url.toString()
      : `${url.origin}/products.json?limit=250`
    try {
      const res = await (deps.fetchImpl ?? fetch)(feed, { signal: AbortSignal.timeout(15_000) })
      if (!res.ok) return { ok: false, error: `Shopify answered HTTP ${res.status}` }
      report = importShopifyProducts(await res.json(), slug, { defaultGame: input.defaultGame })
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  } else
    return {
      ok: false,
      error: "Send a CSV, a Shopify store link, or a shop host that speaks the Anvard protocol.",
    }
  if (input.replace)
    for (const e of await deps.products.listForMerchant(slug))
      await deps.products.remove(slug, e.id)
  for (const p of report.products) await deps.products.upsert(p)
  return { ok: true, imported: report.products.length, skipped: report.skipped.slice(0, 50) }
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
    if (m?.verified && (!deps.maySell || (await deps.maySell(m))))
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
  /** M13: a Lightning address for sats-back (optional). */
  rewardAddress?: string
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
  if (deps.maySell) {
    const m = await deps.receive.getRecipient(input.merchantSlug)
    if (m && !(await deps.maySell(m)))
      return { ok: false, error: "This shop is paused while its plan is renewed. Try again soon." }
  }
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
  const rewardAddress = String(input.rewardAddress ?? "")
    .trim()
    .toLowerCase()
  if (rewardAddress && !isLightningAddress(rewardAddress))
    return { ok: false, error: "The sats-back address must be a Lightning address (name@domain)." }
  try {
    const merchant = await deps.receive.getRecipient(input.merchantSlug)
    if (merchant?.manifestHost) {
      // M16: a remote shop mints its own invoice; shipping goes to the shop in plain text over HTTPS.
      const rr = await remoteRailFor(deps, merchant, input.buyerKey)
      if (!rr) return { ok: false, error: "That shop is not reachable." }
      const ro = await rr.createRemoteOrder({
        items: lines.map((l) => ({ productId: l.productId, qty: Math.floor(Number(l.qty)) })),
        shipping: needsShipping
          ? (input.shipping as {
              name: string
              address: string
              city: string
              region?: string
              postal?: string
              country: string
            })
          : undefined,
        contact: contact || undefined,
      })
      const now = (deps.now ?? (() => new Date()))()
      const price = await deps.price()
      await deps.orders.create({
        id: `rm_${ro.orderId.replace(/[^a-z0-9]+/gi, "-")}`,
        merchantSlug: input.merchantSlug,
        items,
        totalCents: orderTotalCents(items),
        totalSats: ro.amountSats,
        usdCentsPerBtc: price?.usdCentsPerBtc ?? 0n,
        bolt11: ro.bolt11,
        paymentHash: ro.paymentHash ?? "",
        state: "unpaid",
        createdAt: now.toISOString(),
        shippingSealed,
        contactSealed,
        buyerKey: input.buyerKey,
        rewardAddress: rewardAddress || undefined,
        note: `remote:${ro.orderId}`,
      })
      return {
        ok: true,
        orderId: `rm_${ro.orderId.replace(/[^a-z0-9]+/gi, "-")}`,
        bolt11: ro.bolt11,
        paymentHash: ro.paymentHash ?? "",
        totalCents: Number(orderTotalCents(items)),
        totalSats: Number(ro.amountSats),
        expiresInSeconds: 600,
      }
    }
    const o = await rail(deps, input.buyerKey).createCartOrder({
      merchantSlug: input.merchantSlug,
      items,
      shippingSealed,
      contactSealed,
      buyerKey: input.buyerKey,
      rewardAddress: rewardAddress || undefined,
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
  if (
    m?.manifestHost &&
    o.note?.startsWith("remote:") &&
    (o.state === "unpaid" || o.state === "paid")
  ) {
    try {
      const rr = await remoteRailFor(deps, m)
      const st = rr ? await rr.getOrder(o.note.slice("remote:".length)) : null
      if (st && st.state !== "unpaid" && st.state !== o.state) {
        const now = (deps.now ?? (() => new Date()))().toISOString()
        o = {
          ...o,
          state:
            st.state === "delivered" ? "fulfilled" : st.state === "failed" ? "cancelled" : "paid",
          paidAt: o.paidAt ?? now,
          fulfilledAt: st.state === "delivered" ? now : o.fulfilledAt,
          note: st.redemption ? `${o.note} ${st.redemption}`.slice(0, 500) : o.note,
        }
        await deps.orders.update(o)
        await accrueReward(deps, o)
      }
    } catch {
      /* the shop's status endpoint is theirs; try again next poll */
    }
  }
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
        await accrueReward(deps, o)
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
  const paid: ShopOrder = {
    ...o,
    state: "paid",
    preimage: preimage.trim().toLowerCase(),
    paidAt: (deps.now ?? (() => new Date()))().toISOString(),
  }
  await deps.orders.update(paid)
  await accrueReward(deps, paid)
  return { ok: true }
}

/** M13: a paid web order earns sats-back for the address the buyer gave (none → nothing). */
async function accrueReward(deps: ShopDeps, o: ShopOrder): Promise<void> {
  if (!deps.rewards || !o.rewardAddress) return
  try {
    await deps.rewards.accrue({
      orderId: o.id,
      source: "directory",
      merchantSlug: o.merchantSlug,
      purchaseSats: o.totalSats,
      kind: o.items.some((i) => i.kind === "physical") ? "physical" : "digital",
      payoutAddress: o.rewardAddress,
      at: o.paidAt ?? (deps.now ?? (() => new Date()))().toISOString(),
    })
  } catch {
    /* best-effort */
  }
}

/** Public: what an address has earned. */
export async function rewardsForAddress(deps: ShopDeps, address: string) {
  if (!deps.rewardStore || !isLightningAddress(address)) return null
  const list = await deps.rewardStore.listForAddress(address.trim().toLowerCase())
  return {
    ...summarizeRewards(list, (deps.now ?? (() => new Date()))()),
    rewards: list.map((r) => ({
      orderId: r.orderId,
      amountSats: Number(r.amountSats),
      state: r.state,
      payableAt: r.payableAt,
      paidAt: r.paidAt,
    })),
  }
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
