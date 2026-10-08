/**
 * Strike exchange rail (M5). Buys bitcoin with USD on the USER'S OWN Strike account using their
 * scoped API key; optionally pays a Lightning invoice from the Strike balance so bought sats leave
 * the exchange ("sweep", see scheduler).
 *
 * Endpoints (docs.strike.me, verified 2026-10-07):
 *   POST  /v1/currency-exchange-quotes            {sell:"USD", buy:"BTC", amount:{amount,currency}} → quote
 *   PATCH /v1/currency-exchange-quotes/{id}/execute   202, no body
 *   GET   /v1/currency-exchange-quotes/{id}       quote with state COMPLETED + completed
 *   GET   /v1/rates/ticker                        [{amount, sourceCurrency, targetCurrency}]  (shape from secondary sources)
 *   GET   /v1/balances                            [{currency, current, available, ...}]
 *   POST  /v1/payment-quotes/lightning            {lnInvoice, sourceCurrency} → {paymentQuoteId, validUntil, totalAmount}
 *   PATCH /v1/payment-quotes/{id}/execute         {paymentId, state}
 * Scopes the key needs: currency-exchange quote create/execute + rates; plus lightning payment-quote
 * create/execute ONLY if the sweep step is enabled (never grant withdraw-type scopes otherwise).
 *
 * Money crosses this boundary as decimal strings; conversion to integer cents/sats happens here,
 * rounding sats DOWN (we never report more than was bought).
 */
import {
  type Cents,
  type ExchangeRail,
  type Execution,
  type Quote,
  RailError,
  type RailErrorCode,
  SATS_PER_BTC,
  type Sats,
} from "@agentic-bitcoin/core"

export interface StrikeConfig {
  apiKey: string
  baseUrl?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  now?: () => Date
}

interface StrikeQuote {
  id: string
  created?: string
  validUntil: string
  source: { amount: string; currency: string }
  target: { amount: string; currency: string }
  conversionRate: { amount: string; sourceCurrency: string; targetCurrency: string }
  state: "NEW" | "PENDING" | "COMPLETED" | "FAILED" | string
  completed?: string
}

const ERROR_CODES: Record<string, RailErrorCode> = {
  BALANCE_TOO_LOW: "INSUFFICIENT_FUNDS",
  EXCHANGE_RATE_NOT_AVAILABLE: "REJECTED",
  CURRENCY_EXCHANGE_QUOTE_EXPIRED: "EXPIRED",
  NOT_FOUND: "NOT_FOUND",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "UNAUTHORIZED",
  RATE_LIMITED: "UNREACHABLE",
}

export class StrikeExchangeRail implements ExchangeRail {
  readonly kind = "strike"
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly now: () => Date
  private readonly executed = new Map<string, Execution>()
  private readonly quotes = new Map<string, Quote>()

  constructor(private readonly cfg: StrikeConfig) {
    if (!cfg.apiKey) throw new RailError("strike", "BAD_CONFIG", "Strike API key missing")
    this.baseUrl = (cfg.baseUrl ?? "https://api.strike.me/v1").replace(/\/$/, "")
    this.fetchImpl = cfg.fetchImpl ?? fetch
    this.timeoutMs = cfg.timeoutMs ?? 15_000
    this.now = cfg.now ?? (() => new Date())
  }

  async getRate(): Promise<{ usdCentsPerBtc: Cents; asOf: string }> {
    const body = (await this.call("GET", "/rates/ticker")) as unknown
    const list = Array.isArray(body)
      ? (body as { amount: string; sourceCurrency: string; targetCurrency: string }[])
      : []
    const btcUsd = list.find((r) => r.sourceCurrency === "BTC" && r.targetCurrency === "USD")
    if (btcUsd)
      return { usdCentsPerBtc: decimalToCents(btcUsd.amount), asOf: this.now().toISOString() }
    const usdBtc = list.find((r) => r.sourceCurrency === "USD" && r.targetCurrency === "BTC")
    if (usdBtc) {
      // USD→BTC rate is BTC per dollar; invert in integer space: cents/BTC = 1e8 sats / (sats per dollar) * 100
      const satsPerDollar = decimalToSats(usdBtc.amount)
      if (satsPerDollar > 0n)
        return {
          usdCentsPerBtc: (SATS_PER_BTC * 100n) / satsPerDollar,
          asOf: this.now().toISOString(),
        }
    }
    throw new RailError(this.kind, "BAD_RESPONSE", "ticker has no BTC/USD rate")
  }

  async createQuote(input: { usdCents: Cents }): Promise<Quote> {
    if (input.usdCents <= 0n)
      throw new RailError(this.kind, "AMOUNT_OUT_OF_RANGE", "amount must be > 0")
    const q = (await this.call("POST", "/currency-exchange-quotes", {
      sell: "USD",
      buy: "BTC",
      amount: { amount: centsToDecimal(input.usdCents), currency: "USD" },
    })) as StrikeQuote
    const quote = this.toQuote(q)
    this.quotes.set(quote.id, quote)
    return quote
  }

  async executeQuote(quoteId: string): Promise<Execution> {
    const done = this.executed.get(quoteId)
    if (done) return done
    const known = this.quotes.get(quoteId)
    if (known && known.expiresAt <= this.now().toISOString()) {
      throw new RailError(this.kind, "EXPIRED", `quote ${quoteId} expired at ${known.expiresAt}`)
    }
    await this.call("PATCH", `/currency-exchange-quotes/${encodeURIComponent(quoteId)}/execute`)
    // 202 carries no body: read the quote back for the settled figures.
    const q = (await this.call(
      "GET",
      `/currency-exchange-quotes/${encodeURIComponent(quoteId)}`,
    )) as StrikeQuote
    if (q.state === "FAILED") throw new RailError(this.kind, "REJECTED", `quote ${quoteId} failed`)
    const ex: Execution = {
      quoteId,
      sats: decimalToSats(q.target.amount),
      usdCents: decimalToCents(q.source.amount),
      executedAt: q.completed ?? this.now().toISOString(),
    }
    this.executed.set(quoteId, ex)
    return ex
  }

  /** USD available on the account, for a clear "not enough cash" before quoting. */
  async getUsdBalance(): Promise<Cents> {
    const body = (await this.call("GET", "/balances")) as {
      currency: string
      available?: string
      current?: string
    }[]
    const usd = Array.isArray(body) ? body.find((b) => b.currency === "USD") : undefined
    return usd ? decimalToCents(usd.available ?? usd.current ?? "0") : 0n
  }

  /**
   * Sweep: pay a Lightning invoice (made by the user's own wallet) from the Strike balance so the
   * bought sats leave the exchange. Requires the lightning payment-quote scopes.
   */
  async payLightningInvoice(bolt11: string): Promise<{ paymentId: string; totalSats: Sats }> {
    const q = (await this.call("POST", "/payment-quotes/lightning", {
      lnInvoice: bolt11,
      sourceCurrency: "BTC",
    })) as {
      paymentQuoteId: string
      totalAmount?: { amount: string; currency: string }
    }
    const r = (await this.call(
      "PATCH",
      `/payment-quotes/${encodeURIComponent(q.paymentQuoteId)}/execute`,
    )) as { paymentId: string; state: string }
    if (r.state !== "COMPLETED" && r.state !== "PENDING")
      throw new RailError(this.kind, "REJECTED", `lightning payment ${r.state}`)
    const total = q.totalAmount?.currency === "BTC" ? decimalToSats(q.totalAmount.amount) : 0n
    return { paymentId: r.paymentId, totalSats: total }
  }

  private toQuote(q: StrikeQuote): Quote {
    if (!q?.id || !q.validUntil || !q.source || !q.target)
      throw new RailError(this.kind, "BAD_RESPONSE", "malformed quote")
    const usdCents = decimalToCents(q.source.amount)
    const sats = decimalToSats(q.target.amount)
    if (sats <= 0n) throw new RailError(this.kind, "BAD_RESPONSE", "quote has no BTC amount")
    return {
      id: q.id,
      usdCents,
      sats,
      usdCentsPerBtc: (usdCents * SATS_PER_BTC) / sats,
      expiresAt: new Date(q.validUntil).toISOString(),
    }
  }

  private async call(method: string, path: string, body?: unknown): Promise<unknown> {
    let res: Response
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.cfg.apiKey}`,
          accept: "application/json",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (err) {
      throw new RailError(this.kind, "UNREACHABLE", `strike ${path}: ${(err as Error).message}`)
    }
    const text = await res.text()
    if (res.ok) return text ? JSON.parse(text) : null
    const parsed = safeJson(text) as {
      data?: { code?: string; message?: string }
      code?: string
      message?: string
    } | null
    const code = parsed?.data?.code ?? parsed?.code
    const message = parsed?.data?.message ?? parsed?.message ?? text.slice(0, 200)
    if (res.status === 401 || res.status === 403)
      throw new RailError(
        this.kind,
        "UNAUTHORIZED",
        `strike ${res.status}: ${message || "check the API key and its scopes"}`,
      )
    if (res.status === 404) throw new RailError(this.kind, "NOT_FOUND", `strike 404 ${path}`)
    if (res.status === 429) throw new RailError(this.kind, "UNREACHABLE", "strike rate limited")
    if (res.status === 451)
      throw new RailError(this.kind, "UNAUTHORIZED", "exchange rail unavailable in your region")
    const mapped = (code && ERROR_CODES[code]) || (res.status >= 500 ? "UNREACHABLE" : "REJECTED")
    throw new RailError(this.kind, mapped, `strike ${res.status} ${code ?? ""}: ${message}`.trim())
  }
}

function safeJson(t: string): unknown {
  try {
    return JSON.parse(t)
  } catch {
    return null
  }
}

/** "5.00" → 500n, "0.1" → 10n. Rounds down beyond cents (Strike quotes are 2dp USD). */
export function decimalToCents(s: string): Cents {
  return decimalToUnits(s, 2)
}

/** "0.00006012" → 6012n sats (floor). */
export function decimalToSats(s: string): Sats {
  return decimalToUnits(s, 8)
}

export function centsToDecimal(c: Cents): string {
  return `${c / 100n}.${(c % 100n).toString().padStart(2, "0")}` // money-ok: integer bigint formatting
}

function decimalToUnits(s: string, places: number): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(s).trim())
  if (!m) throw new RailError("strike", "BAD_RESPONSE", `not a decimal amount: ${s}`)
  const whole = m[1] ?? "0"
  const frac = ((m[2] ?? "") + "0".repeat(places)).slice(0, places)
  return BigInt(whole) * 10n ** BigInt(places) + BigInt(frac)
}
