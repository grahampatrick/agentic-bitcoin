/**
 * Pay links (M14, ADR-0018): the public view of an issued invoice, minted lazily on the issuer's
 * wallet for web-onboarded recipients (chat issuers mint at creation), settlement by the issuer's
 * wallet or the payer's preimage, and the recipient dashboard's create/void/mark-paid/CSV.
 */
import {
  INVOICE_EXPIRY_SECONDS,
  type InvoiceItem,
  type InvoiceStore,
  type IssuedInvoice,
  type PriceSnapshot,
  centsToSats,
  invoiceStatus,
  invoiceTotalCents,
  invoicesCsv,
  newInvoiceToken,
  preimageMatches,
} from "@agentic-bitcoin/core"
import {
  NwcWalletRail,
  buildInvoice,
  decryptSecret,
  encryptSecret,
  parseKey,
} from "@agentic-bitcoin/rails"
import { hashToken } from "../receive/service"
import type { ReceiveStore } from "../receive/store"

export interface InvoiceDeps {
  invoices: InvoiceStore
  receive: ReceiveStore
  price(): Promise<PriceSnapshot | undefined>
  baseUrl: string
  secretsKey?: Buffer | null
  fetchImpl?: typeof fetch
  now?: () => Date
  walletFor?: (cs: string) => {
    makeInvoice: NwcWalletRail["makeInvoice"]
    lookupInvoice?: NwcWalletRail["lookupInvoice"]
    close?(): void
  }
}
const key = (d: InvoiceDeps) =>
  d.secretsKey === undefined
    ? process.env.SECRETS_KEY
      ? parseKey(process.env.SECRETS_KEY)
      : null
    : d.secretsKey
const nowOf = (d: InvoiceDeps) => (d.now ?? (() => new Date()))()

export interface PayView {
  number: string
  kind: IssuedInvoice["kind"]
  issuerName: string
  payerName: string
  items: { description: string; qty: number; unitCents: number }[]
  totalCents: number
  amountSats?: number
  bolt11?: string
  paymentHash?: string
  status: ReturnType<typeof invoiceStatus>
  dueAt?: string
  expiresAt?: string
  paidAt?: string
  memo?: string
  /** True when we can see settlement ourselves (recipient wallet connected). */
  canVerify: boolean
}

const recipientSlugOf = (issuer: string) =>
  issuer.startsWith("recipient:") ? issuer.slice("recipient:".length) : null

/** Mint (or re-mint after expiry) on a web-onboarded recipient's wallet, and check settlement. */
async function refresh(deps: InvoiceDeps, i: IssuedInvoice): Promise<IssuedInvoice> {
  const slug = recipientSlugOf(i.issuer)
  if (!slug || i.state !== "open") return i
  const r = await deps.receive.getRecipient(slug)
  if (!r) return i
  const k = key(deps)
  const now = nowOf(deps)
  const expired = !i.bolt11 || (i.expiresAt ? i.expiresAt < now.toISOString() : false)
  const wallet =
    r.nwcReceive && k
      ? (deps.walletFor ?? ((cs: string) => new NwcWalletRail({ connectionString: cs })))(
          decryptSecret(r.nwcReceive, k),
        )
      : null
  try {
    if (!expired && i.paymentHash && wallet?.lookupInvoice) {
      try {
        const look = await wallet.lookupInvoice(i.paymentHash)
        if (look.state === "settled") {
          const paid = {
            ...i,
            state: "paid" as const,
            paidAt: look.settledAt ?? now.toISOString(),
            preimage: look.preimage,
          }
          await deps.invoices.update(paid)
          return paid
        }
      } catch {
        /* the recipient's wallet app remains the record */
      }
      return i
    }
    if (!expired) return i
    const price = await deps.price()
    if (!price) return i
    const sats = centsToSats(i.totalCents, price)
    const amountSats = sats < 1n ? 1n : sats
    const source = wallet
      ? ({ kind: "nwc", wallet } as const)
      : ({ kind: "proxy", lightningAddress: r.lightningAddress } as const)
    const minted = await buildInvoice({
      name: r.name,
      source,
      amountMsats: Number(amountSats * 1000n), // money-ok: sats → msats at the LNURL boundary
      comment: `${i.number} ${i.payerName}`.slice(0, 100),
      fetchImpl: (deps.fetchImpl ?? fetch) as never,
    })
    const next: IssuedInvoice = {
      ...i,
      bolt11: minted.pr,
      paymentHash: minted.paymentHash.toLowerCase(),
      amountSats,
      usdCentsPerBtc: price.usdCentsPerBtc,
      mintedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + INVOICE_EXPIRY_SECONDS * 1000).toISOString(),
    }
    await deps.invoices.update(next)
    return next
  } finally {
    wallet?.close?.()
  }
}

export async function payView(deps: InvoiceDeps, token: string): Promise<PayView | null> {
  let i = await deps.invoices.getByToken(token)
  if (!i) return null
  i = await refresh(deps, i)
  const slug = recipientSlugOf(i.issuer)
  const r = slug ? await deps.receive.getRecipient(slug) : null
  return {
    number: i.number,
    kind: i.kind,
    issuerName: i.issuerName ?? r?.name ?? "the issuer",
    payerName: i.payerName,
    items: i.items.map((x) => ({
      description: x.description,
      qty: x.qty,
      unitCents: Number(x.unitCents),
    })),
    totalCents: Number(i.totalCents),
    amountSats: i.amountSats === undefined ? undefined : Number(i.amountSats),
    bolt11: i.state === "open" ? i.bolt11 : undefined,
    paymentHash: i.paymentHash,
    status: invoiceStatus(i, nowOf(deps)),
    dueAt: i.dueAt,
    expiresAt: i.expiresAt,
    paidAt: i.paidAt,
    memo: i.memo,
    canVerify: !!(r?.nwcReceive && key(deps)),
  }
}

export async function claimInvoicePaid(deps: InvoiceDeps, token: string, preimage: string) {
  const i = await deps.invoices.getByToken(token)
  if (!i) return { ok: false as const, error: "No such invoice." }
  if (i.state === "paid") return { ok: true as const }
  if (i.state !== "open" || !i.paymentHash)
    return { ok: false as const, error: "This invoice cannot be paid." }
  if (!preimageMatches(preimage.trim(), i.paymentHash))
    return { ok: false as const, error: "That preimage does not match this invoice." }
  await deps.invoices.update({
    ...i,
    state: "paid",
    paidAt: nowOf(deps).toISOString(),
    preimage: preimage.trim().toLowerCase(),
  })
  return { ok: true as const }
}

// --- recipient dashboard -------------------------------------------------------------------------

async function authed(deps: InvoiceDeps, slug: string, token: string) {
  const r = await deps.receive.getRecipient(slug)
  if (!r || !r.dashboardTokenHash || !token || hashToken(token) !== r.dashboardTokenHash)
    return null
  return r
}

export interface InvoiceForm {
  kind: "invoice" | "request"
  payerName: string
  payerContact?: string
  items: { description: string; qty: number; price: string }[]
  memo?: string
  dueDate?: string
}

export async function createRecipientInvoice(
  deps: InvoiceDeps,
  slug: string,
  token: string,
  form: InvoiceForm,
) {
  const r = await authed(deps, slug, token)
  if (!r) return { ok: false as const, error: "Not authorized." }
  const payerName = (form.payerName ?? "").trim().slice(0, 80)
  if (!payerName) return { ok: false as const, error: "Who is this for?" }
  const items: InvoiceItem[] = []
  for (const it of (form.items ?? []).slice(0, 50)) {
    const description = String(it.description ?? "")
      .trim()
      .slice(0, 120)
    const qty = Math.floor(Number(it.qty ?? 1))
    const t = String(it.price ?? "").replace(/[$,\s]/g, "")
    if (!description || !Number.isInteger(qty) || qty < 1 || !/^\d+(\.\d{1,2})?$/.test(t))
      return { ok: false as const, error: "Each item needs a description, a quantity and a price." }
    const [d, c = ""] = t.split(".")
    items.push({ description, qty, unitCents: BigInt(d ?? "0") * 100n + BigInt(c.padEnd(2, "0")) })
  }
  if (!items.length || invoiceTotalCents(items) < 1n)
    return { ok: false as const, error: "Add at least one item with a price." }
  const k = key(deps)
  const contact = (form.payerContact ?? "").trim().slice(0, 120)
  if (contact && !k)
    return {
      ok: false as const,
      error: "Contact details cannot be stored on this server (no SECRETS_KEY).",
    }
  let dueAt: string | undefined
  if (form.dueDate?.trim()) {
    const d = new Date(`${form.dueDate.trim()}T23:59:59.000Z`)
    if (Number.isNaN(d.getTime()))
      return { ok: false as const, error: "Due date must be YYYY-MM-DD." }
    dueAt = d.toISOString()
  }
  const issuer = `recipient:${r.slug}`
  const inv: IssuedInvoice = {
    id: `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    number: await deps.invoices.nextNumber(issuer),
    issuer,
    issuerName: r.name,
    kind: form.kind === "request" ? "request" : "invoice",
    payerName,
    payerContactSealed: contact && k ? encryptSecret(contact, k) : undefined,
    items,
    totalCents: invoiceTotalCents(items),
    memo: form.memo?.trim().slice(0, 200) || undefined,
    dueAt,
    state: "open",
    token: newInvoiceToken(),
    createdAt: nowOf(deps).toISOString(),
  }
  await deps.invoices.create(inv)
  return {
    ok: true as const,
    id: inv.id,
    number: inv.number,
    link: `${deps.baseUrl.replace(/\/$/, "")}/pay/${inv.token}`,
  }
}

export async function recipientInvoices(deps: InvoiceDeps, slug: string, token: string) {
  const r = await authed(deps, slug, token)
  if (!r) return null
  const k = key(deps)
  const now = nowOf(deps)
  const list = await deps.invoices.listForIssuer(`recipient:${r.slug}`, 200)
  return list.map((i) => {
    let payerContact: string | undefined
    if (i.payerContactSealed && k) {
      try {
        payerContact = decryptSecret(i.payerContactSealed, k)
      } catch {
        /* rotated key */
      }
    }
    return {
      id: i.id,
      number: i.number,
      kind: i.kind,
      payerName: i.payerName,
      payerContact,
      items: i.items.map((x) => ({ ...x, unitCents: Number(x.unitCents) })),
      totalCents: Number(i.totalCents),
      amountSats: i.amountSats === undefined ? undefined : Number(i.amountSats),
      status: invoiceStatus(i, now),
      dueAt: i.dueAt,
      createdAt: i.createdAt,
      paidAt: i.paidAt,
      link: `${deps.baseUrl.replace(/\/$/, "")}/pay/${i.token}`,
    }
  })
}

export async function recipientInvoiceAction(
  deps: InvoiceDeps,
  slug: string,
  token: string,
  id: string,
  action: "void" | "mark_paid",
) {
  const r = await authed(deps, slug, token)
  const i = r ? await deps.invoices.get(id) : null
  if (!r || !i || i.issuer !== `recipient:${r.slug}`)
    return { ok: false as const, error: "Not authorized." }
  if (i.state !== "open") return { ok: false as const, error: `Already ${i.state}.` }
  const now = nowOf(deps).toISOString()
  await deps.invoices.update(
    action === "void"
      ? { ...i, state: "void", voidedAt: now }
      : { ...i, state: "paid", paidAt: now, paidReported: true },
  )
  return { ok: true as const }
}

export async function recipientInvoicesCsv(deps: InvoiceDeps, slug: string, token: string) {
  const r = await authed(deps, slug, token)
  if (!r) return null
  return invoicesCsv(await deps.invoices.listForIssuer(`recipient:${r.slug}`, 1000), nowOf(deps))
}
