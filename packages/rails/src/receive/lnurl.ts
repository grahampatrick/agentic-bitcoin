/**
 * The receive side (M10, ADR-0014): LNURL-pay for a recipient, with the invoice always minted by
 * the RECIPIENT's wallet, never ours. Two sources:
 *
 *   proxy — the recipient already has a Lightning address; we relay LNURL-pay to it and hand back
 *           its invoice unchanged (amount verified by decoding).
 *   nwc   — the recipient paired a receive-only Nostr Wallet Connect string (make_invoice only);
 *           we call make_invoice in their wallet. The connection must not be able to pay.
 *
 * Pure over an injected fetch and wallet so it is unit-tested; nothing here stores anything.
 */
import { type Invoice, RailError, type Sats, isLightningAddress } from "@agentic-bitcoin/core"
import { decodeInvoice } from "@getalby/lightning-tools"

export interface LnurlPayRequest {
  tag: "payRequest"
  callback: string
  minSendable: number
  maxSendable: number
  /** JSON string: [["text/plain", …], ["text/identifier", …]] */
  metadata: string
  commentAllowed?: number
}

export type ReceiveSource =
  | { kind: "proxy"; lightningAddress: string }
  | {
      kind: "nwc"
      wallet: {
        makeInvoice(input: {
          amountSats: Sats
          memo: string
          expirySeconds: number
        }): Promise<Invoice>
      }
    }

type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export const RECEIVE_MIN_MSATS = 1_000 // 1 sat
export const RECEIVE_MAX_MSATS = 10_000_000_000 // 10,000,000 sats
export const COMMENT_MAX = 200
export const INVOICE_EXPIRY_SECONDS = 600

export function lnurlMetadata(name: string, identifier: string): string {
  return JSON.stringify([
    ["text/plain", `Give to ${name}`],
    ["text/identifier", identifier],
  ])
}

/** GET the upstream LNURL-pay metadata of an existing Lightning address. */
export async function upstreamPayRequest(
  lightningAddress: string,
  fetchImpl: FetchLike,
  timeoutMs = 6000,
): Promise<LnurlPayRequest> {
  const a = lightningAddress.trim().toLowerCase()
  if (!isLightningAddress(a)) throw new RailError("lnurl", "BAD_CONFIG", "not a lightning address")
  const [name, domain] = a.split("@") as [string, string]
  let res: Awaited<ReturnType<FetchLike>>
  try {
    res = await fetchImpl(`https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw new RailError("lnurl", "UNREACHABLE", `${domain}: ${(err as Error).message}`)
  }
  if (!res.ok) throw new RailError("lnurl", "UNREACHABLE", `${domain} answered HTTP ${res.status}`)
  const j = (await res.json()) as Partial<LnurlPayRequest> & { status?: string; reason?: string }
  if (j.status === "ERROR") throw new RailError("lnurl", "REJECTED", j.reason ?? "LNURL error")
  if (
    j.tag !== "payRequest" ||
    typeof j.callback !== "string" ||
    typeof j.minSendable !== "number" ||
    typeof j.maxSendable !== "number"
  )
    throw new RailError("lnurl", "BAD_RESPONSE", `${domain}: not an LNURL-pay endpoint`)
  return {
    tag: "payRequest",
    callback: j.callback,
    minSendable: j.minSendable,
    maxSendable: j.maxSendable,
    metadata: typeof j.metadata === "string" ? j.metadata : "[]",
    commentAllowed: typeof j.commentAllowed === "number" ? j.commentAllowed : 0,
  }
}

/** The payRequest we serve at /.well-known/lnurlp/<slug>. The callback is ours; the payee is the recipient. */
export async function buildPayRequest(opts: {
  slug: string
  name: string
  /** e.g. https://agentic-bitcoin.vercel.app */
  baseUrl: string
  source: ReceiveSource
  fetchImpl: FetchLike
}): Promise<LnurlPayRequest> {
  const host = new URL(opts.baseUrl).host
  const base = {
    tag: "payRequest" as const,
    callback: `${opts.baseUrl.replace(/\/$/, "")}/api/lnurlp/${opts.slug}/callback`,
    metadata: lnurlMetadata(opts.name, `${opts.slug}@${host}`),
  }
  if (opts.source.kind === "nwc") {
    return {
      ...base,
      minSendable: RECEIVE_MIN_MSATS,
      maxSendable: RECEIVE_MAX_MSATS,
      commentAllowed: COMMENT_MAX,
    }
  }
  const up = await upstreamPayRequest(opts.source.lightningAddress, opts.fetchImpl)
  return {
    ...base,
    minSendable: Math.max(up.minSendable, RECEIVE_MIN_MSATS),
    maxSendable: Math.min(up.maxSendable, RECEIVE_MAX_MSATS),
    commentAllowed: Math.min(up.commentAllowed ?? 0, COMMENT_MAX),
  }
}

export interface MintedInvoice {
  pr: string
  paymentHash: string
  amountMsats: number
  source: ReceiveSource["kind"]
}

/** Produce the invoice for a payer. Amount in msats, as LNURL-pay specifies. */
export async function buildInvoice(opts: {
  name: string
  source: ReceiveSource
  amountMsats: number
  comment?: string
  fetchImpl: FetchLike
  timeoutMs?: number
}): Promise<MintedInvoice> {
  const amount = opts.amountMsats
  if (!Number.isInteger(amount) || amount < RECEIVE_MIN_MSATS || amount > RECEIVE_MAX_MSATS)
    throw new RailError("lnurl", "AMOUNT_OUT_OF_RANGE", "amount out of range")
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
  const comment = (opts.comment ?? "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, COMMENT_MAX)

  if (opts.source.kind === "nwc") {
    if (amount % 1000 !== 0) throw new RailError("lnurl", "AMOUNT_OUT_OF_RANGE", "whole sats only")
    const inv = await opts.source.wallet.makeInvoice({
      amountSats: BigInt(amount / 1000), // money-ok: msats → sats at the LNURL boundary
      memo: comment ? `Give to ${opts.name}: ${comment}` : `Give to ${opts.name}`,
      expirySeconds: INVOICE_EXPIRY_SECONDS,
    })
    return { pr: inv.bolt11, paymentHash: inv.paymentHash, amountMsats: amount, source: "nwc" }
  }

  const up = await upstreamPayRequest(opts.source.lightningAddress, opts.fetchImpl, opts.timeoutMs)
  if (amount < up.minSendable || amount > up.maxSendable)
    throw new RailError("lnurl", "AMOUNT_OUT_OF_RANGE", "amount outside the recipient's range")
  const url = new URL(up.callback)
  url.searchParams.set("amount", String(amount))
  if (comment && (up.commentAllowed ?? 0) > 0)
    url.searchParams.set("comment", comment.slice(0, up.commentAllowed))
  let res: Awaited<ReturnType<FetchLike>>
  try {
    res = await fetchImpl(url.toString(), { signal: AbortSignal.timeout(opts.timeoutMs ?? 8000) })
  } catch (err) {
    throw new RailError("lnurl", "UNREACHABLE", (err as Error).message)
  }
  if (!res.ok) throw new RailError("lnurl", "UNREACHABLE", `callback HTTP ${res.status}`)
  const j = (await res.json()) as { pr?: string; status?: string; reason?: string }
  if (j.status === "ERROR" || typeof j.pr !== "string")
    throw new RailError("lnurl", "REJECTED", j.reason ?? "no invoice returned")
  const decoded = decodeInvoice(j.pr)
  if (!decoded) throw new RailError("lnurl", "BAD_RESPONSE", "undecodable invoice")
  if (decoded.millisatoshi !== amount)
    throw new RailError(
      "lnurl",
      "BAD_RESPONSE",
      `recipient's invoice is for ${decoded.millisatoshi} msat, asked ${amount}`,
    )
  return { pr: j.pr, paymentHash: decoded.paymentHash, amountMsats: amount, source: "proxy" }
  function fetchImpl(u: string, init?: { signal?: AbortSignal }) {
    return opts.fetchImpl(u, init)
  }
}

/**
 * A receive-only connection may create and look up invoices and nothing else. Anything that can
 * spend is refused: we would otherwise hold a key to someone's money.
 */
export function assessReceiveConnection(probe: { methods?: string[] }):
  | { ok: true; warning?: string }
  | { ok: false; error: string } {
  const m = probe.methods
  if (!m) return { ok: false, error: "the wallet did not say which methods this connection allows" }
  const spenders = m.filter((x) =>
    /^(pay_invoice|multi_pay_invoice|pay_keysend|multi_pay_keysend|sign_message)$/.test(x),
  )
  if (spenders.length)
    return {
      ok: false,
      error: `this connection can spend (${spenders.join(", ")}). Create a RECEIVE-ONLY connection with just make_invoice and lookup_invoice, then try again.`,
    }
  if (!m.includes("make_invoice"))
    return { ok: false, error: "this connection cannot create invoices (needs make_invoice)" }
  return {
    ok: true,
    warning: m.includes("lookup_invoice")
      ? undefined
      : "without lookup_invoice I cannot show you which gifts settled; your wallet app will.",
  }
}

/** LNURL error envelope. */
export function lnurlError(reason: string): { status: "ERROR"; reason: string } {
  return { status: "ERROR", reason }
}
