/**
 * Recipients (M9, ADR-0013): the receive side of giving. A recipient is someone the user can give
 * to by name — a church, a missionary, a creator, a merchant — with a Lightning address we resolve
 * at pay time. Directory recipients are verified by the operator or by their own domain; a user
 * may also add private recipients that only they can see and give to.
 *
 * Nothing here holds money: a recipient is a name and a Lightning address. Every string that a
 * recipient supplies (name, description, website) is untrusted text to the agent.
 */
import type { LedgerEntry } from "./ledger"
import type { Cents, Sats } from "./money"

export type RecipientKind = "church" | "missionary" | "creator" | "merchant"
export const RECIPIENT_KINDS: readonly RecipientKind[] = [
  "church",
  "missionary",
  "creator",
  "merchant",
]

export type GivePurpose = "tithe" | "offering" | "support" | "tip" | "gift"
export const GIVE_PURPOSES: readonly GivePurpose[] = ["tithe", "offering", "support", "tip", "gift"]

export interface Recipient {
  /** Operator-assigned, stable, lower-case `[a-z0-9-]`. Never derived from untrusted text at pay time. */
  slug: string
  kind: RecipientKind
  name: string
  /** `name@domain`, resolved by the wallet rail (LNURL-pay) when a gift is executed. */
  lightningAddress: string
  /** null = unverified. Directory entries must be verified before anyone may give to them. */
  verified: { how: "domain" | "operator"; at: string } | null
  website?: string
  country?: string
  description?: string
  /** Set when a user added this recipient privately; only that user sees it or may give to it. */
  ownerUserId?: string
  /**
   * M10: a receive-only wallet connection (make_invoice, never pay_invoice), SEALED with SECRETS_KEY.
   * Only the web receive service decrypts it, to mint invoices in the recipient's wallet. Never logged.
   */
  nwcReceive?: string
  /** When the recipient onboarded themselves (web /receive); null/undefined for operator-seeded entries. */
  submittedAt?: string
}

/** A user-scoped view: the directory plus that user's private recipients. */
export interface RecipientReader {
  get(slug: string): Promise<Recipient | null>
  search(query: string): Promise<Recipient[]>
  list(): Promise<Recipient[]>
}

export interface RecipientStore {
  readonly kind: string
  /** Directory entries (no owner) plus, when `userId` is given, that user's private ones. */
  get(slug: string, userId?: string): Promise<Recipient | null>
  search(query: string, userId?: string): Promise<Recipient[]>
  list(userId?: string): Promise<Recipient[]>
  upsert(r: Recipient): Promise<void>
  remove(slug: string): Promise<void>
}

/** Scope a store to one user, so the executor and agent never see another user's private list. */
export function recipientsForUser(store: RecipientStore, userId: string): RecipientReader {
  return {
    get: (slug) => store.get(slug, userId),
    search: (q) => store.search(q, userId),
    list: () => store.list(userId),
  }
}

/** May this user give to the recipient? Verified directory entries, or the user's own private entries. */
export function isTrustedRecipient(r: Recipient, userId: string): boolean {
  if (r.ownerUserId) return r.ownerUserId === userId
  return r.verified !== null
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/

export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
  return s
}

export function isLightningAddress(s: string): boolean {
  return /^[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(s.trim())
}

const visible = (r: Recipient, userId?: string) =>
  !r.ownerUserId || (userId !== undefined && r.ownerUserId === userId)

/** Case-insensitive match on slug, name, description, country; whole-word-ish, tokens all present. */
export function recipientMatches(r: Recipient, query: string): boolean {
  const q = query.toLowerCase().trim()
  if (!q) return true
  const hay =
    `${r.slug} ${r.name} ${r.kind} ${r.description ?? ""} ${r.country ?? ""}`.toLowerCase()
  return q
    .split(/\s+/)
    .filter((t) => t.length > 1 && !["the", "a", "to", "for", "my", "in"].includes(t))
    .every((t) => hay.includes(t))
}

export class InMemoryRecipientStore implements RecipientStore {
  readonly kind = "memory"
  private readonly m = new Map<string, Recipient>()
  constructor(seed: readonly Recipient[] = []) {
    for (const r of seed) this.m.set(r.slug, r)
  }
  async get(slug: string, userId?: string) {
    const r = this.m.get(slug.toLowerCase())
    return r && visible(r, userId) ? r : null
  }
  async search(query: string, userId?: string) {
    return [...this.m.values()].filter((r) => visible(r, userId) && recipientMatches(r, query))
  }
  async list(userId?: string) {
    return [...this.m.values()].filter((r) => visible(r, userId))
  }
  async upsert(r: Recipient) {
    if (!SLUG_RE.test(r.slug)) throw new Error(`bad slug: ${r.slug}`)
    this.m.set(r.slug, r)
  }
  async remove(slug: string) {
    this.m.delete(slug)
  }
}

// --- giving statement -------------------------------------------------------------------------

export interface GivingRow {
  date: string
  recipientSlug: string
  recipientName: string
  purpose: GivePurpose
  sats: Sats
  /** USD cents at the time of the gift, when a price was known. */
  usdCents: Cents | null
  preimage?: string
}

/** Succeeded gifts in a calendar year (UTC), oldest first. Pure: feed it folded ledger entries. */
export function givingRows(entries: readonly LedgerEntry[], year: number): GivingRow[] {
  const rows: GivingRow[] = []
  for (const e of entries) {
    if (e.action.kind !== "give" || e.outcome !== "succeeded") continue
    if (!e.at.startsWith(`${year}-`)) continue
    rows.push({
      date: e.at.slice(0, 10),
      recipientSlug: e.action.recipientSlug,
      recipientName: e.action.recipientName,
      purpose: e.action.purpose,
      sats: e.action.amountSats,
      usdCents: e.action.fiatCentsAtRequest ?? null,
      preimage: e.preimage,
    })
  }
  return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

/** CSV with a header. We are not the donee: the recipient issues any receipt (OQ-14). */
export function givingStatementCsv(rows: readonly GivingRow[]): string {
  const lines = ["date,recipient,slug,purpose,sats,usd,preimage"]
  for (const r of rows) {
    const usd =
      r.usdCents === null
        ? ""
        : `${(r.usdCents / 100n).toString()}.${(r.usdCents % 100n).toString().padStart(2, "0")}` // money-ok: display
    lines.push(
      [
        r.date,
        csvCell(r.recipientName),
        r.recipientSlug,
        r.purpose,
        r.sats.toString(),
        usd,
        r.preimage ?? "",
      ].join(","),
    )
  }
  return `${lines.join("\n")}\n`
}
