/**
 * The receive service (M10, ADR-0014): LNURL-pay for a recipient, onboarding, and the dashboard.
 * Pure over an injected store/fetch/clock so routes stay thin and tests never touch the network.
 */
import { createHash, randomBytes } from "node:crypto"
import {
  RECIPIENT_KINDS,
  RailError,
  type Recipient,
  SLUG_RE,
  isLightningAddress,
  slugify,
} from "@agentic-bitcoin/core"
import {
  type LnurlPayRequest,
  NwcWalletRail,
  type ReceiveSource,
  assessReceiveConnection,
  buildInvoice,
  buildPayRequest,
  decryptSecret,
  encryptSecret,
  lnurlError,
  parseKey,
  probeLightningAddress,
  validateConnectionString,
  verificationFor,
} from "@agentic-bitcoin/rails"
import type { ReceiveInvoice, ReceiveStore } from "./store"

export const INVOICES_PER_MINUTE = 30

export interface ReceiveDeps {
  store: ReceiveStore
  baseUrl: string
  fetchImpl?: typeof fetch
  now?: () => Date
  secretsKey?: Buffer | null
  /** Build a wallet from a receive-only connection string (injected so tests use a fake). */
  walletFor?: (connectionString: string) => {
    makeInvoice: NwcWalletRail["makeInvoice"]
    lookupInvoice: NwcWalletRail["lookupInvoice"]
    describeConnection: NwcWalletRail["describeConnection"]
    close(): void
  }
}

const defaults = (d: ReceiveDeps) => ({
  fetchImpl: d.fetchImpl ?? fetch,
  now: d.now ?? (() => new Date()),
  secretsKey:
    d.secretsKey === undefined
      ? process.env.SECRETS_KEY
        ? parseKey(process.env.SECRETS_KEY)
        : null
      : d.secretsKey,
  walletFor: d.walletFor ?? ((cs: string) => new NwcWalletRail({ connectionString: cs })),
})

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

/** Public fields only: what a /give or /tip page may show. */
export type PublicRecipient = Pick<
  Recipient,
  "slug" | "kind" | "name" | "website" | "country" | "description"
> & { verified: boolean; lightningAddress: string }

export function publicView(r: Recipient, baseUrl: string): PublicRecipient {
  return {
    slug: r.slug,
    kind: r.kind,
    name: r.name,
    website: r.website,
    country: r.country,
    description: r.description,
    verified: r.verified !== null,
    lightningAddress: `${r.slug}@${new URL(baseUrl).host}`,
  }
}

function sourceFor(r: Recipient, d: ReturnType<typeof defaults>): ReceiveSource {
  if (r.nwcReceive) {
    if (!d.secretsKey)
      throw new RailError("receive", "BAD_CONFIG", "SECRETS_KEY is not set on this server")
    return { kind: "nwc", wallet: d.walletFor(decryptSecret(r.nwcReceive, d.secretsKey)) }
  }
  return { kind: "proxy", lightningAddress: r.lightningAddress }
}

/** GET /.well-known/lnurlp/<slug> */
export async function payRequestFor(
  deps: ReceiveDeps,
  slug: string,
): Promise<LnurlPayRequest | ReturnType<typeof lnurlError>> {
  const d = defaults(deps)
  const r = await deps.store.getRecipient(slug)
  if (!r) return lnurlError("unknown recipient")
  try {
    const src = sourceFor(r, d)
    try {
      return await buildPayRequest({
        slug: r.slug,
        name: r.name,
        baseUrl: deps.baseUrl,
        source: src,
        fetchImpl: d.fetchImpl,
      })
    } finally {
      if (src.kind === "nwc") (src.wallet as { close?: () => void }).close?.()
    }
  } catch (err) {
    return lnurlError(err instanceof RailError ? err.message : "temporarily unavailable")
  }
}

/** GET /api/lnurlp/<slug>/callback?amount=<msats>&comment=… */
export async function invoiceFor(
  deps: ReceiveDeps,
  slug: string,
  amountMsats: number,
  comment?: string,
  campaignSlug?: string,
): Promise<{ pr: string; routes: []; paymentHash: string } | ReturnType<typeof lnurlError>> {
  const d = defaults(deps)
  const r = await deps.store.getRecipient(slug)
  if (!r) return lnurlError("unknown recipient")
  const since = new Date(d.now().getTime() - 60_000).toISOString()
  if ((await deps.store.countInvoicesSince(r.slug, since)) >= INVOICES_PER_MINUTE)
    return lnurlError("too many requests for this recipient; try again in a minute")
  try {
    const src = sourceFor(r, d)
    try {
      const inv = await buildInvoice({
        name: r.name,
        source: src,
        amountMsats,
        comment,
        fetchImpl: d.fetchImpl,
      })
      await deps.store.recordInvoice({
        paymentHash: inv.paymentHash,
        slug: r.slug,
        amountMsats: inv.amountMsats,
        comment: comment?.slice(0, 200) || undefined,
        source: inv.source,
        createdAt: d.now().toISOString(),
        campaignSlug:
          campaignSlug && /^[a-z0-9-]{2,63}$/.test(campaignSlug) ? campaignSlug : undefined,
      })
      return { pr: inv.pr, routes: [], paymentHash: inv.paymentHash }
    } finally {
      if (src.kind === "nwc") (src.wallet as { close?: () => void }).close?.()
    }
  } catch (err) {
    return lnurlError(err instanceof RailError ? err.message : "could not create an invoice")
  }
}

// --- onboarding ---------------------------------------------------------------------------------

export interface OnboardForm {
  name: string
  kind: string
  website?: string
  country?: string
  description?: string
  contact?: string
  lightningAddress?: string
  nwc?: string
}
export type OnboardResult =
  | {
      ok: true
      slug: string
      lightningAddress: string
      dashboardToken: string
      verified: boolean
      warning?: string
    }
  | { ok: false; error: string }

export async function onboardRecipient(
  deps: ReceiveDeps,
  form: OnboardForm,
): Promise<OnboardResult> {
  const d = defaults(deps)
  // A recipient must outlive the process: without a database (and not in dev) we refuse rather than lose them.
  if (deps.store.kind === "memory" && process.env.NODE_ENV === "production")
    return { ok: false, error: "Onboarding is not enabled on this server yet (no database)." }
  const name = (form.name ?? "").trim().slice(0, 80)
  if (name.length < 2) return { ok: false, error: "Give the recipient a name." }
  if (!RECIPIENT_KINDS.includes(form.kind as Recipient["kind"]))
    return { ok: false, error: "Pick church, missionary, creator or merchant." }
  const slug = slugify(name)
  if (!SLUG_RE.test(slug)) return { ok: false, error: "That name does not make a usable address." }
  if (await deps.store.getRecipient(slug))
    return { ok: false, error: `“${slug}” is taken. Add a place or a word to the name.` }
  let website: string | undefined
  if (form.website?.trim()) {
    try {
      const u = new URL(
        form.website.trim().startsWith("http")
          ? form.website.trim()
          : `https://${form.website.trim()}`,
      )
      if (u.protocol !== "https:") throw new Error()
      website = u.toString().replace(/\/$/, "")
    } catch {
      return { ok: false, error: "The website must be an https:// address." }
    }
  }
  const base: Omit<Recipient, "lightningAddress" | "verified"> = {
    slug,
    kind: form.kind as Recipient["kind"],
    name,
    website,
    country: form.country?.trim().slice(0, 2).toUpperCase() || undefined,
    description: form.description?.trim().slice(0, 300) || undefined,
    submittedAt: d.now().toISOString(),
  }
  const token = randomBytes(24).toString("hex")
  const host = new URL(deps.baseUrl).host

  const nwc = form.nwc?.trim()
  if (nwc) {
    if (!d.secretsKey)
      return {
        ok: false,
        error: "Wallet connections are not enabled on this server (no SECRETS_KEY).",
      }
    try {
      validateConnectionString(nwc)
    } catch (err) {
      return { ok: false, error: `Not a wallet connection string: ${(err as Error).message}` }
    }
    const wallet = d.walletFor(nwc)
    let verdict: ReturnType<typeof assessReceiveConnection>
    try {
      verdict = assessReceiveConnection(await wallet.describeConnection())
    } catch (err) {
      wallet.close()
      return { ok: false, error: `I could not reach that wallet: ${(err as Error).message}` }
    } finally {
      wallet.close()
    }
    if (!verdict.ok) return { ok: false, error: verdict.error }
    await deps.store.createRecipient({
      ...base,
      lightningAddress: `${slug}@${host}`,
      verified: null,
      nwcReceive: encryptSecret(nwc, d.secretsKey),
      dashboardTokenHash: hashToken(token),
      contact: form.contact?.trim().slice(0, 120) || undefined,
    })
    return {
      ok: true,
      slug,
      lightningAddress: `${slug}@${host}`,
      dashboardToken: token,
      verified: false,
      warning: verdict.warning,
    }
  }

  const address = (form.lightningAddress ?? "").trim().toLowerCase()
  if (!isLightningAddress(address))
    return {
      ok: false,
      error: "Enter a Lightning address (name@domain) or a receive-only wallet connection.",
    }
  if (address.endsWith(`@${host}`))
    return { ok: false, error: "That address is already one of ours." }
  const probe = await probeLightningAddress(address, d.fetchImpl as never)
  if (!probe.ok)
    return { ok: false, error: `That address does not answer Lightning payments (${probe.error}).` }
  const verified = verificationFor({ lightningAddress: address, website }, probe, d.now)
  await deps.store.createRecipient({
    ...base,
    lightningAddress: address,
    verified,
    dashboardTokenHash: hashToken(token),
    contact: form.contact?.trim().slice(0, 120) || undefined,
  })
  return {
    ok: true,
    slug,
    lightningAddress: `${slug}@${host}`,
    dashboardToken: token,
    verified: verified !== null,
  }
}

// --- dashboard ----------------------------------------------------------------------------------

export interface Dashboard {
  recipient: PublicRecipient
  invoices: ReceiveInvoice[]
  settledMsats: number
  canSeeSettlement: boolean
}

export async function dashboardFor(
  deps: ReceiveDeps,
  slug: string,
  token: string,
): Promise<Dashboard | null> {
  const d = defaults(deps)
  const r = await deps.store.getRecipient(slug)
  if (!r || !r.dashboardTokenHash || !token || hashToken(token) !== r.dashboardTokenHash)
    return null
  let invoices = await deps.store.listInvoices(r.slug, 50)
  const canSeeSettlement = !!r.nwcReceive && !!d.secretsKey
  if (canSeeSettlement && r.nwcReceive && d.secretsKey) {
    const wallet = d.walletFor(decryptSecret(r.nwcReceive, d.secretsKey))
    try {
      for (const inv of invoices.filter((i) => !i.settledAt).slice(0, 20)) {
        try {
          const look = await wallet.lookupInvoice(inv.paymentHash)
          if (look.state === "settled") {
            const at = look.settledAt ?? d.now().toISOString()
            await deps.store.markSettled(inv.paymentHash, at, look.preimage)
          }
        } catch {
          /* leave unsettled; the wallet app is authoritative */
        }
      }
    } finally {
      wallet.close()
    }
    invoices = await deps.store.listInvoices(r.slug, 50)
  }
  return {
    recipient: publicView(r, deps.baseUrl),
    invoices,
    settledMsats: invoices.filter((i) => i.settledAt).reduce((a, i) => a + i.amountMsats, 0),
    canSeeSettlement,
  }
}

/** The one-line snippet a recipient pastes into their site. */
export function tipSnippet(baseUrl: string, slug: string, name: string): string {
  const b = baseUrl.replace(/\/$/, "")
  return `<a href="${b}/tip/${slug}"><img src="${b}/api/tip-badge/${slug}" alt="Tip ${name} in bitcoin" height="32"></a>`
}

export function siteBaseUrl(req?: Request): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL
  if (env) return env.replace(/\/$/, "")
  if (req) {
    const u = new URL(req.url)
    const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "")
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? u.host
    return `${proto}://${host}`
  }
  return "http://localhost:3900"
}
