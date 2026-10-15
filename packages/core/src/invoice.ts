/**
 * Invoices and payment requests (M14, ADR-0018): a bill someone can pay over Lightning. The BOLT11 is
 * minted by the ISSUER's own wallet; our pay link is a pointer to it, never a balance. Money is cents
 * (ADR-0004) with sats fixed when the BOLT11 is minted. The payer's contact is sealed; their name is
 * on the invoice by nature. Every string from either side is data to the agent.
 */
import { randomBytes } from "node:crypto"
import type { Cents, Sats } from "./money"

export type IssuedInvoiceState = "open" | "paid" | "void"

export interface InvoiceItem {
  description: string
  qty: number
  unitCents: Cents
}

export interface IssuedInvoice {
  id: string
  /** Sequential per issuer, for humans: "INV-0007". */
  number: string
  /** Chat issuer: the user id. Web-onboarded recipient: `recipient:<slug>`. */
  issuer: string
  issuerName?: string
  /** "invoice" has items and a due date; "request" is a one-liner for a person. */
  kind: "invoice" | "request"
  payerName: string
  payerContactSealed?: string
  items: InvoiceItem[]
  totalCents: Cents
  memo?: string
  dueAt?: string
  state: IssuedInvoiceState
  /** Unguessable, in the pay link. */
  token: string
  /** The issuer's current BOLT11 for this bill, with its hash and sats fixed at mint time. */
  bolt11?: string
  paymentHash?: string
  amountSats?: Sats
  usdCentsPerBtc?: Cents
  mintedAt?: string
  expiresAt?: string
  createdAt: string
  paidAt?: string
  preimage?: string
  /** Paid outside Lightning and recorded by the issuer. */
  paidReported?: boolean
  voidedAt?: string
}

export interface InvoiceStore {
  readonly kind: string
  get(id: string): Promise<IssuedInvoice | null>
  getByToken(token: string): Promise<IssuedInvoice | null>
  getByPaymentHash(hash: string): Promise<IssuedInvoice | null>
  listForIssuer(issuer: string, limit?: number): Promise<IssuedInvoice[]>
  /** Open invoices with a BOLT11 that may have settled (for the settlement tick). */
  listOpenMinted(): Promise<IssuedInvoice[]>
  nextNumber(issuer: string): Promise<string>
  create(i: IssuedInvoice): Promise<void>
  update(i: IssuedInvoice): Promise<void>
}

export const INVOICE_TOKEN_RE = /^[a-z0-9]{24,32}$/
export const INVOICE_EXPIRY_SECONDS = 7 * 86_400

export function newInvoiceToken(): string {
  return randomBytes(16).toString("hex").slice(0, 28)
}

export function invoiceTotalCents(items: readonly InvoiceItem[]): Cents {
  return items.reduce((a, i) => a + i.unitCents * BigInt(i.qty), 0n)
}

/** "overdue" is derived, never stored. */
export function invoiceStatus(
  i: IssuedInvoice,
  now: Date,
): IssuedInvoiceState | "overdue" | "expired" {
  if (i.state !== "open") return i.state
  if (i.dueAt && i.dueAt < now.toISOString()) return "overdue"
  if (i.expiresAt && i.expiresAt < now.toISOString()) return "expired"
  return "open"
}

export function describeInvoice(i: IssuedInvoice): string {
  const what =
    i.items.length === 1 ? (i.items[0] as InvoiceItem).description : `${i.items.length} items`
  return `${i.number} ${i.payerName} · ${what}`
}

/** Pay-link token → URL and back. */
export function payLinkFor(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/$/, "")}/pay/${token}`
}
export function tokenFromPayLink(text: string): string | null {
  const m = /\/pay\/([a-z0-9]{24,32})\b/i.exec(text.trim())
  return m ? (m[1] as string).toLowerCase() : null
}

export class InMemoryInvoiceStore implements InvoiceStore {
  readonly kind = "memory"
  readonly m = new Map<string, IssuedInvoice>()
  async get(id: string) {
    return this.m.get(id) ?? null
  }
  async getByToken(token: string) {
    return [...this.m.values()].find((i) => i.token === token) ?? null
  }
  async getByPaymentHash(hash: string) {
    return [...this.m.values()].find((i) => i.paymentHash === hash.toLowerCase()) ?? null
  }
  async listForIssuer(issuer: string, limit = 100) {
    return [...this.m.values()]
      .filter((i) => i.issuer === issuer)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit)
  }
  async listOpenMinted() {
    return [...this.m.values()].filter((i) => i.state === "open" && !!i.paymentHash)
  }
  async nextNumber(issuer: string) {
    const n = [...this.m.values()].filter((i) => i.issuer === issuer).length + 1
    return `INV-${String(n).padStart(4, "0")}`
  }
  async create(i: IssuedInvoice) {
    if (this.m.has(i.id)) throw new Error("invoice exists")
    this.m.set(i.id, { ...i, paymentHash: i.paymentHash?.toLowerCase() })
  }
  async update(i: IssuedInvoice) {
    this.m.set(i.id, { ...i, paymentHash: i.paymentHash?.toLowerCase() })
  }
}

/** CSV for the issuer's records: one line per invoice. */
export function invoicesCsv(list: readonly IssuedInvoice[], now: Date): string {
  const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const usd = (c: Cents) => `${(c / 100n).toString()}.${(c % 100n).toString().padStart(2, "0")}` // money-ok: display
  const lines = ["number,created,due,payer,description,usd,sats,status,paid,hash"]
  for (const i of list) {
    lines.push(
      [
        i.number,
        i.createdAt.slice(0, 10),
        i.dueAt?.slice(0, 10) ?? "",
        cell(i.payerName),
        cell(i.items.map((x) => `${x.qty}× ${x.description}`).join("; ")),
        usd(i.totalCents),
        i.amountSats?.toString() ?? "",
        invoiceStatus(i, now),
        i.paidAt?.slice(0, 10) ?? "",
        i.paymentHash ?? "",
      ].join(","),
    )
  }
  return `${lines.join("\n")}\n`
}
