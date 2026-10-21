/**
 * The Anvard commerce protocol, v0 (M16, ADR-0020): how any Lightning merchant exposes itself to
 * any agent in four pieces — a manifest, a product feed, a checkout that returns the merchant's own
 * BOLT11, and an order status. The preimage is the receipt. Nothing here moves money through us.
 * These are the wire shapes plus pure validators; the HTTP lives in apps/web (serving) and
 * packages/rails (consuming).
 */
import type { Cents, Sats } from "./money"
import {
  PRODUCT_ID_RE,
  SHOP_CATEGORIES,
  type ShopCategory,
  type ShopProduct,
  type TcgFields,
} from "./shop"

export const PROTOCOL_VERSION = "0.1"
export const MANIFEST_PATH = "/.well-known/anvard.json"

/** Served at /.well-known/anvard.json on the merchant's host. */
export interface MerchantManifest {
  anvard: typeof PROTOCOL_VERSION
  merchant: {
    slug: string
    name: string
    website?: string
    country?: string
    description?: string
    /** Where the merchant takes Lightning payments; informational (checkout returns the invoice). */
    lightningAddress?: string
  }
  endpoints: {
    products: string
    checkout: string
    /** `{id}` is replaced with the order id. */
    order: string
  }
  /** Hex Nostr public key the merchant signs feeds with (optional in v0). */
  signingPubkey?: string
}

export interface FeedProduct {
  id: string
  title: string
  description?: string
  imageUrl?: string
  category: string
  /** Integer cents (USD) or integer sats; exactly one. */
  priceCents?: number
  priceSats?: number
  dealCents?: number
  kind: "digital" | "physical"
  inStock: boolean
  shipsTo?: string[]
  tcg?: TcgFields
}

export interface ProductFeed {
  anvard: typeof PROTOCOL_VERSION
  merchant: string
  updatedAt: string
  products: FeedProduct[]
}

export interface CheckoutRequest {
  anvard: typeof PROTOCOL_VERSION
  items: { productId: string; qty: number }[]
  /** Plain shipping for the merchant (sent over HTTPS to them; we never store it unsealed). */
  shipping?: {
    name: string
    address: string
    city: string
    region?: string
    postal?: string
    country: string
  }
  contact?: string
  /** Opaque buyer reference the merchant echoes back; never personal data. */
  buyerRef?: string
}

export interface CheckoutResponse {
  anvard: typeof PROTOCOL_VERSION
  orderId: string
  bolt11: string
  paymentHash: string
  amountSats: number
  totalCents?: number
  expiresAt: string
  fulfilment: "instant" | "shipped"
}

export interface OrderStatusResponse {
  anvard: typeof PROTOCOL_VERSION
  orderId: string
  state: "unpaid" | "paid" | "fulfilled" | "cancelled"
  paymentHash: string
  paidAt?: string
  fulfilledAt?: string
  /** Digital goods: the deliverable once fulfilled (a link or code). Bearer data. */
  redemption?: string
  note?: string
}

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ProtocolError"
  }
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/
const isObj = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x)
const str = (x: unknown, max = 500) => (typeof x === "string" ? x.slice(0, max) : undefined)

export function parseManifest(json: unknown, host: string): MerchantManifest {
  if (!isObj(json) || json.anvard !== PROTOCOL_VERSION)
    throw new ProtocolError(`not an anvard ${PROTOCOL_VERSION} manifest`)
  const m = json.merchant
  const e = json.endpoints
  if (!isObj(m) || !isObj(e)) throw new ProtocolError("manifest needs merchant and endpoints")
  const slug = str(m.slug, 63) ?? ""
  if (!SLUG_RE.test(slug)) throw new ProtocolError("bad merchant slug")
  const name = str(m.name, 120)?.trim()
  if (!name) throw new ProtocolError("merchant needs a name")
  const abs = (u: unknown, what: string): string => {
    const s = str(u, 2048)
    if (!s) throw new ProtocolError(`manifest needs endpoints.${what}`)
    const url = new URL(s, `https://${host}/`)
    if (url.protocol !== "https:") throw new ProtocolError(`${what} must be https`)
    // keep the `{id}` placeholder readable (URL percent-encodes braces)
    return url.toString().replace(/%7Bid%7D/gi, "{id}")
  }
  return {
    anvard: PROTOCOL_VERSION,
    merchant: {
      slug,
      name,
      website: str(m.website, 300),
      country: str(m.country, 2)?.toUpperCase(),
      description: str(m.description, 300),
      lightningAddress: str(m.lightningAddress, 120)?.toLowerCase(),
    },
    endpoints: {
      products: abs(e.products, "products"),
      checkout: abs(e.checkout, "checkout"),
      order: abs(e.order, "order"),
    },
    signingPubkey: /^[0-9a-f]{64}$/i.test(String(json.signingPubkey ?? ""))
      ? String(json.signingPubkey).toLowerCase()
      : undefined,
  }
}

/** Convert a feed product to our catalogue shape, with sats prices turned into cents at the given price. */
export function productFromFeed(
  merchantSlug: string,
  f: unknown,
  satsToCents: (sats: Sats) => Cents,
): ShopProduct {
  if (!isObj(f)) throw new ProtocolError("product is not an object")
  const id = str(f.id, 63) ?? ""
  if (!PRODUCT_ID_RE.test(id)) throw new ProtocolError(`bad product id "${id}"`)
  const title = str(f.title, 120)?.trim()
  if (!title) throw new ProtocolError(`product ${id} needs a title`)
  const category = (SHOP_CATEGORIES as readonly string[]).includes(String(f.category))
    ? (f.category as ShopCategory)
    : "other"
  const cents =
    Number.isInteger(f.priceCents) && Number(f.priceCents) >= 0
      ? BigInt(Number(f.priceCents))
      : undefined
  const sats =
    Number.isInteger(f.priceSats) && Number(f.priceSats) > 0
      ? BigInt(Number(f.priceSats))
      : undefined
  if ((cents === undefined) === (sats === undefined))
    throw new ProtocolError(`product ${id}: exactly one of priceCents or priceSats`)
  const priceCents = cents ?? satsToCents(sats as Sats)
  const deal =
    Number.isInteger(f.dealCents) && Number(f.dealCents) >= 0
      ? BigInt(Number(f.dealCents))
      : undefined
  let tcg: TcgFields | undefined
  if (isObj(f.tcg)) {
    const t = f.tcg
    const game = str(t.game, 40)?.toLowerCase().trim()
    const set = str(t.set, 120)?.trim()
    if (game && set) {
      let provenanceUrl: string | undefined
      const pu = str(t.provenanceUrl, 500)
      if (pu) {
        try {
          const u = new URL(pu)
          if (u.protocol === "https:") provenanceUrl = u.toString()
        } catch {
          /* ignore a bad link */
        }
      }
      tcg = {
        game,
        set,
        number: str(t.number, 20),
        condition: str(t.condition, 20),
        grade: str(t.grade, 20),
        finish: str(t.finish, 20),
        language: str(t.language, 10),
        provenanceUrl,
      }
    }
  }
  let imageUrl: string | undefined
  const iu = str(f.imageUrl, 1000)
  if (iu) {
    try {
      const u = new URL(iu)
      if (u.protocol === "https:") imageUrl = u.toString()
    } catch {
      /* ignore */
    }
  }
  return {
    id,
    merchantSlug,
    title,
    description: str(f.description, 1000),
    imageUrl,
    category,
    priceCents,
    dealCents: deal !== undefined && deal < priceCents ? deal : undefined,
    kind: f.kind === "digital" ? "digital" : "physical",
    inStock: f.inStock !== false,
    shipsTo: Array.isArray(f.shipsTo)
      ? f.shipsTo.map((x) => String(x).toUpperCase().slice(0, 2))
      : undefined,
    tcg,
  }
}

export function parseFeed(
  json: unknown,
  merchantSlug: string,
  satsToCents: (sats: Sats) => Cents,
): ShopProduct[] {
  if (!isObj(json) || json.anvard !== PROTOCOL_VERSION)
    throw new ProtocolError("not an anvard feed")
  if (json.merchant !== merchantSlug)
    throw new ProtocolError("feed merchant does not match the manifest")
  if (!Array.isArray(json.products)) throw new ProtocolError("feed needs products[]")
  const out: ShopProduct[] = []
  for (const p of json.products.slice(0, 5000)) {
    try {
      out.push(productFromFeed(merchantSlug, p, satsToCents))
    } catch {
      /* one bad row never hides a catalogue */
    }
  }
  return out
}

export function parseCheckoutResponse(json: unknown): CheckoutResponse {
  if (!isObj(json) || json.anvard !== PROTOCOL_VERSION)
    throw new ProtocolError("not an anvard checkout response")
  const orderId = str(json.orderId, 120)
  const bolt11 = str(json.bolt11, 4000)
  const paymentHash = str(json.paymentHash, 64)?.toLowerCase()
  const amountSats = Number(json.amountSats)
  const expiresAt = str(json.expiresAt, 40)
  if (
    !orderId ||
    !bolt11?.toLowerCase().startsWith("ln") ||
    !paymentHash ||
    !/^[0-9a-f]{64}$/.test(paymentHash) ||
    !Number.isInteger(amountSats) ||
    amountSats < 1 ||
    !expiresAt
  )
    throw new ProtocolError(
      "checkout response is missing orderId, bolt11, paymentHash, amountSats or expiresAt",
    )
  return {
    anvard: PROTOCOL_VERSION,
    orderId,
    bolt11,
    paymentHash,
    amountSats,
    totalCents: Number.isInteger(json.totalCents) ? Number(json.totalCents) : undefined,
    expiresAt,
    fulfilment: json.fulfilment === "instant" ? "instant" : "shipped",
  }
}

export function parseOrderStatus(json: unknown): OrderStatusResponse {
  if (!isObj(json) || json.anvard !== PROTOCOL_VERSION)
    throw new ProtocolError("not an anvard order status")
  const state = String(json.state)
  if (!["unpaid", "paid", "fulfilled", "cancelled"].includes(state))
    throw new ProtocolError("bad order state")
  return {
    anvard: PROTOCOL_VERSION,
    orderId: str(json.orderId, 120) ?? "",
    state: state as OrderStatusResponse["state"],
    paymentHash: str(json.paymentHash, 64)?.toLowerCase() ?? "",
    paidAt: str(json.paidAt, 40),
    fulfilledAt: str(json.fulfilledAt, 40),
    redemption: str(json.redemption, 2000),
    note: str(json.note, 500),
  }
}

/** Global id for a remote merchant's product: `rm:<merchant>:<id>`. */
export function remoteProductId(merchantSlug: string, id: string): string {
  return `rm:${merchantSlug}:${id}`
}
export function parseRemoteProductId(gid: string): { merchantSlug: string; id: string } | null {
  const m = /^rm:([a-z0-9][a-z0-9-]{1,62}):([a-z0-9][a-z0-9-]{0,62})$/.exec(gid)
  return m ? { merchantSlug: m[1] as string, id: m[2] as string } : null
}
