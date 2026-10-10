/**
 * NWC wallet rail (ADR-0006): the single wallet socket. Speaks NIP-47 through @getalby/sdk to
 * whatever wallet issued the connection string (Alby Hub, Coinos, LNbits, Primal, Zeus, …).
 *
 * Safety properties this adapter guarantees on top of the core policy engine:
 * - The approved amount is checked against the DECODED invoice before paying (a bolt11 for more
 *   than was approved is refused, not "paid and logged").
 * - Idempotent on `idempotencyKey`, and before any pay it looks the payment hash up: if this
 *   wallet already settled it, the stored preimage is returned and nothing is paid again.
 * - A timeout after `pay_invoice` is NOT a failure: the hash is polled, and if still unknown the
 *   error is `UNKNOWN_STATE`, which keeps the ledger entry pending (budget stays reserved).
 * - The connection string never appears in errors or logs.
 */
import {
  type Invoice,
  type InvoiceLookup,
  type Payment,
  RailError,
  type RailErrorCode,
  type Sats,
  type WalletRail,
} from "@agentic-bitcoin/core"
import { LightningAddress, decodeInvoice } from "@getalby/lightning-tools"
import { NWCClient } from "@getalby/sdk/nwc"

/** The slice of NWCClient we use, so tests can inject a fake and the SDK can change under us. */
export interface NwcClientLike {
  getBalance(): Promise<{ balance: number }>
  makeInvoice(req: { amount: number; description?: string; expiry?: number }): Promise<{
    invoice: string
    payment_hash: string
    expires_at?: number
  }>
  payInvoice(req: { invoice: string; amount?: number }): Promise<{
    preimage: string
    fees_paid: number
  }>
  lookupInvoice(req: { payment_hash?: string; invoice?: string }): Promise<{
    type?: "incoming" | "outgoing"
    state: "settled" | "pending" | "failed" | "accepted"
    preimage?: string
    settled_at?: number
    fees_paid?: number
    amount?: number
  }>
  getInfo?(): Promise<{ alias: string; network: string; methods: string[]; lud16?: string }>
  getWalletServiceInfo?(): Promise<{ capabilities?: string[] }>
  getBudget?(): Promise<
    | { used_budget: number; total_budget: number; renews_at?: number; renewal_period: string }
    | Record<string, never>
  >
  close?(): void
}

export type AddressResolver = (
  address: string,
  amountSats: Sats,
  memo?: string,
) => Promise<{ bolt11: string }>

export interface NwcWalletRailOptions {
  /** `nostr+walletconnect://…` — kept only inside the SDK client, never stored on this object. */
  connectionString?: string
  /** Inject a client (tests, or a pre-built NWCClient). */
  client?: NwcClientLike
  resolveAddress?: AddressResolver
  now?: () => Date
  /** How long to poll `lookup_invoice` after a pay timeout before giving up as UNKNOWN_STATE. */
  settleTimeoutMs?: number
  pollIntervalMs?: number
  sleep?: (ms: number) => Promise<void>
}

const MSATS = 1000n

export class NwcWalletRail implements WalletRail {
  readonly kind = "nwc"
  private readonly client: NwcClientLike
  private readonly resolver: AddressResolver
  private readonly now: () => Date
  private readonly settleTimeoutMs: number
  private readonly pollIntervalMs: number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly payments = new Map<string, Payment>()

  constructor(opts: NwcWalletRailOptions) {
    if (opts.client) {
      this.client = opts.client
    } else if (opts.connectionString) {
      validateConnectionString(opts.connectionString)
      this.client = new NWCClient({ nostrWalletConnectUrl: opts.connectionString })
    } else {
      throw new RailError("nwc", "BAD_CONFIG", "NwcWalletRail needs a connectionString or a client")
    }
    this.resolver = opts.resolveAddress ?? resolveViaLnurl
    this.now = opts.now ?? (() => new Date())
    this.settleTimeoutMs = opts.settleTimeoutMs ?? 30_000
    this.pollIntervalMs = opts.pollIntervalMs ?? 2_000
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  async getBalance(): Promise<{ sats: Sats }> {
    const r = await this.guard(() => this.client.getBalance())
    return { sats: msatsToSats(r.balance) }
  }

  async makeInvoice(input: {
    amountSats: Sats
    memo: string
    expirySeconds: number
  }): Promise<Invoice> {
    if (input.amountSats <= 0n)
      throw new RailError(this.kind, "AMOUNT_OUT_OF_RANGE", "amount must be > 0")
    const tx = await this.guard(() =>
      this.client.makeInvoice({
        amount: Number(input.amountSats * MSATS),
        description: input.memo,
        expiry: input.expirySeconds,
      }),
    )
    const expiresAt = tx.expires_at
      ? new Date(tx.expires_at * 1000).toISOString()
      : new Date(this.now().getTime() + input.expirySeconds * 1000).toISOString()
    return {
      bolt11: tx.invoice,
      paymentHash: tx.payment_hash,
      amountSats: input.amountSats,
      expiresAt,
    }
  }

  async lookupInvoice(paymentHash: string): Promise<InvoiceLookup> {
    const tx = await this.guard(() => this.client.lookupInvoice({ payment_hash: paymentHash }))
    if (tx.state === "settled") {
      return {
        state: "settled",
        settledAt: tx.settled_at ? new Date(tx.settled_at * 1000).toISOString() : undefined,
        preimage: tx.preimage || undefined,
      }
    }
    if (tx.state === "failed") return { state: "expired" }
    return { state: "pending" }
  }

  async payInvoice(input: {
    bolt11: string
    amountSats: Sats
    idempotencyKey: string
  }): Promise<Payment> {
    const prior = this.payments.get(input.idempotencyKey)
    if (prior) return prior
    if (input.amountSats <= 0n)
      throw new RailError(this.kind, "AMOUNT_OUT_OF_RANGE", "amount must be > 0")

    const decoded = decodeInvoice(input.bolt11)
    if (!decoded) throw new RailError(this.kind, "REJECTED", "not a decodable bolt11")
    const invoiceSats = BigInt(decoded.satoshi)
    if (invoiceSats !== 0n && invoiceSats !== input.amountSats) {
      throw new RailError(
        this.kind,
        "AMOUNT_OUT_OF_RANGE",
        `invoice is for ${invoiceSats} sats, approved ${input.amountSats}`,
      )
    }
    const paymentHash = decoded.paymentHash

    // Crash recovery: did this wallet already settle this exact invoice?
    const already = await this.findSettled(paymentHash)
    if (already) {
      this.payments.set(input.idempotencyKey, already)
      return already
    }

    try {
      const r = await this.guard(() =>
        this.client.payInvoice(
          invoiceSats === 0n
            ? { invoice: input.bolt11, amount: Number(input.amountSats * MSATS) }
            : { invoice: input.bolt11 },
        ),
      )
      const payment: Payment = {
        paymentHash,
        preimage: r.preimage,
        amountSats: input.amountSats,
        feeSats: msatsToSatsUp(r.fees_paid ?? 0),
      }
      this.payments.set(input.idempotencyKey, payment)
      return payment
    } catch (err) {
      if (err instanceof RailError && err.code === "UNREACHABLE") {
        // The request may have reached the wallet. Poll before declaring anything.
        const settled = await this.waitForSettlement(paymentHash)
        if (settled) {
          this.payments.set(input.idempotencyKey, settled)
          return settled
        }
        throw new RailError(
          this.kind,
          "UNKNOWN_STATE",
          `payment ${paymentHash.slice(0, 8)}… may be in flight`,
        )
      }
      throw err
    }
  }

  resolveAddress(address: string, amountSats: Sats, memo?: string): Promise<{ bolt11: string }> {
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(address)) {
      return Promise.reject(
        new RailError(this.kind, "REJECTED", `not a lightning address: ${address}`),
      )
    }
    return this.resolver(address, amountSats, memo)
  }

  /**
   * What the wallet says about this connection, for onboarding checks. Never the secret.
   * Resilient: capabilities come from the wallet's info event (no request round-trip), a balance
   * read is the liveness test, and get_info / get_budget are asked only when advertised and are
   * allowed to fail. `budget: undefined` means "could not verify", `null` means "none".
   */
  async describeConnection(): Promise<{
    alias?: string
    network?: string
    methods?: string[]
    budget?: { usedSats: Sats; totalSats: Sats; renewal: string } | null
  }> {
    // Capabilities from the wallet's info event: free (no request), and the only honest signal of
    // which optional methods the wallet will answer. Absent → try everything, tolerate failure.
    let caps: string[] | undefined
    try {
      caps = (await this.client.getWalletServiceInfo?.())?.capabilities?.filter(
        (c) => c !== "notifications",
      )
    } catch {
      caps = undefined
    }
    const supports = (m: string) => !caps || caps.includes(m)
    // The real liveness check: every NIP-47 wallet answers get_balance.
    await this.getBalance()
    let alias: string | undefined
    let network: string | undefined
    let methods = caps
    if (this.client.getInfo && supports("get_info")) {
      try {
        const info = await this.client.getInfo()
        alias = info?.alias
        network = info?.network
        if (!methods && Array.isArray(info?.methods)) methods = info.methods
      } catch {
        /* optional */
      }
    }
    let budget: { usedSats: Sats; totalSats: Sats; renewal: string } | null | undefined
    if (this.client.getBudget && supports("get_budget")) {
      try {
        const b = await this.client.getBudget()
        budget = isBudget(b)
          ? {
              usedSats: msatsToSats(b.used_budget),
              totalSats: msatsToSats(b.total_budget),
              renewal: b.renewal_period,
            }
          : null
      } catch {
        budget = undefined
      }
    }
    return { alias, network, methods, budget }
  }

  close(): void {
    this.client.close?.()
  }

  private async findSettled(paymentHash: string): Promise<Payment | null> {
    try {
      const tx = await this.client.lookupInvoice({ payment_hash: paymentHash })
      if (tx.state === "settled" && tx.preimage && tx.type !== "incoming") {
        return {
          paymentHash,
          preimage: tx.preimage,
          amountSats: msatsToSats(tx.amount ?? 0),
          feeSats: msatsToSatsUp(tx.fees_paid ?? 0),
        }
      }
      return null
    } catch {
      return null // unknown hash is the normal case
    }
  }

  private async waitForSettlement(paymentHash: string): Promise<Payment | null> {
    const deadline = this.now().getTime() + this.settleTimeoutMs
    while (this.now().getTime() < deadline) {
      const p = await this.findSettled(paymentHash)
      if (p) return p
      await this.sleep(this.pollIntervalMs)
    }
    return null
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      throw toRailError(err)
    }
  }
}

// --- helpers ----------------------------------------------------------------------------------

type Nip47Budget = {
  used_budget: number
  total_budget: number
  renews_at?: number
  renewal_period: string
}
function isBudget(b: unknown): b is Nip47Budget {
  return typeof b === "object" && b !== null && "total_budget" in b && "used_budget" in b
}

export function msatsToSats(msats: number | bigint): Sats {
  return BigInt(msats) / MSATS
}

/** Fees round UP to the sat so the ledger never understates cost. */
export function msatsToSatsUp(msats: number | bigint): Sats {
  const m = BigInt(msats)
  return (m + MSATS - 1n) / MSATS
}

/** NIP-47 error codes → our typed codes. Unknown codes become REJECTED with the wallet's message. */
const NIP47_CODES: Record<string, RailErrorCode> = {
  INSUFFICIENT_BALANCE: "INSUFFICIENT_FUNDS",
  QUOTA_EXCEEDED: "INSUFFICIENT_FUNDS",
  PAYMENT_FAILED: "REJECTED",
  NOT_FOUND: "NOT_FOUND",
  UNAUTHORIZED: "UNAUTHORIZED",
  RESTRICTED: "UNAUTHORIZED",
  RATE_LIMITED: "UNREACHABLE",
  NOT_IMPLEMENTED: "BAD_CONFIG",
  INTERNAL: "REJECTED",
  OTHER: "REJECTED",
}

export function toRailError(err: unknown): RailError {
  if (err instanceof RailError) return err
  const e = err as { name?: string; code?: string; message?: string }
  const message = redact(e?.message ?? String(err))
  if (
    e?.name === "Nip47TimeoutError" ||
    e?.name === "Nip47PublishTimeoutError" ||
    e?.name === "Nip47ReplyTimeoutError"
  ) {
    return new RailError("nwc", "UNREACHABLE", `timeout: ${message}`)
  }
  if (e?.name === "Nip47NetworkError" || e?.name === "Nip47PublishError") {
    return new RailError("nwc", "UNREACHABLE", message)
  }
  if (e?.name === "Nip47WalletError" && e.code) {
    return new RailError("nwc", NIP47_CODES[e.code] ?? "REJECTED", `${e.code}: ${message}`)
  }
  if (e?.name?.startsWith("Nip47")) return new RailError("nwc", "BAD_RESPONSE", message)
  // A plain JS error is a bug on our side, not a network problem: never let it masquerade as "in flight".
  if (["TypeError", "RangeError", "SyntaxError", "ReferenceError"].includes(e?.name ?? "")) {
    return new RailError("nwc", "BAD_RESPONSE", message)
  }
  return new RailError("nwc", "UNREACHABLE", message)
}

/** Strip anything that looks like an NWC secret or a bare 64-hex key from a message. */
export function redact(text: string): string {
  return text
    .replace(/secret=[0-9a-f]{64}/gi, "secret=[redacted]")
    .replace(/nostr\+walletconnect:\/\/[0-9a-f]{64}/gi, "nostr+walletconnect://[redacted]")
    .replace(/\b[0-9a-f]{64}\b/gi, (m) => `${m.slice(0, 8)}…`)
}

/** Validate shape without ever returning the secret. */
export function validateConnectionString(url: string): {
  walletPubkey: string
  relayUrls: string[]
  hasSecret: boolean
} {
  let parsed: { walletPubkey: string; relayUrls: string[]; secret?: string }
  try {
    parsed = NWCClient.parseWalletConnectUrl(url, false)
  } catch {
    throw new RailError("nwc", "BAD_CONFIG", "not a nostr+walletconnect:// URL")
  }
  if (!parsed.secret) throw new RailError("nwc", "BAD_CONFIG", "connection string has no secret")
  if (parsed.relayUrls.length === 0)
    throw new RailError("nwc", "BAD_CONFIG", "connection string has no relay")
  return { walletPubkey: parsed.walletPubkey, relayUrls: parsed.relayUrls, hasSecret: true }
}

/** A display form that is safe to log: pubkey prefix + relay, never the secret. */
export function describeConnectionString(url: string): string {
  const v = validateConnectionString(url)
  return `nwc ${v.walletPubkey.slice(0, 8)}… via ${v.relayUrls.join(", ")}`
}

/** LUD-16 resolution straight to the domain (no proxy), returning a bolt11 for the amount. */
export const resolveViaLnurl: AddressResolver = async (address, amountSats, memo) => {
  const la = new LightningAddress(address, { proxy: false })
  try {
    await la.fetch()
  } catch (err) {
    throw new RailError(
      "lnurl",
      "UNREACHABLE",
      `could not fetch ${address}: ${(err as Error).message}`,
    )
  }
  if (!la.lnurlpData)
    throw new RailError("lnurl", "NOT_FOUND", `${address} has no LNURL-pay endpoint`)
  const inv = await la.requestInvoice({ satoshi: Number(amountSats), comment: memo })
  const decoded = decodeInvoice(inv.paymentRequest)
  if (!decoded || BigInt(decoded.satoshi) !== amountSats) {
    throw new RailError(
      "lnurl",
      "BAD_RESPONSE",
      `${address} returned an invoice for a different amount`,
    )
  }
  return { bolt11: inv.paymentRequest }
}
