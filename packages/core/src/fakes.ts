/**
 * Deterministic fakes: the reference implementations of the rail contracts, used by the unit suite,
 * the contract suite, dev mode and demos. No randomness; an injectable clock.
 */
import { createHash } from "node:crypto"
import { type Cents, SATS_PER_BTC, type Sats } from "./money"
import {
  type ExchangeRail,
  type Execution,
  type GoodsRail,
  type Invoice,
  type InvoiceLookup,
  type Order,
  type Payment,
  type Product,
  type Quote,
  RailError,
  type WalletRail,
} from "./rails"

export type Clock = () => Date

const sha = (s: string) => createHash("sha256").update(s).digest("hex")

/**
 * Fake wallet. Pays any bolt11 that starts with `lnbc`; a bolt11 containing `fail` is rejected,
 * one containing `nofunds` raises INSUFFICIENT_FUNDS. Invoices it created can be marked settled
 * with `settle(paymentHash)`. Idempotent on key.
 */
export class FakeWalletRail implements WalletRail {
  readonly kind = "fake-wallet"
  private balance: Sats
  private readonly invoices = new Map<string, Invoice & { state: InvoiceLookup }>()
  private readonly payments = new Map<string, Payment>()
  private seq = 0

  constructor(
    opts: { balanceSats?: Sats; now?: Clock } = {},
    private readonly now: Clock = opts.now ?? (() => new Date(0)),
  ) {
    this.balance = opts.balanceSats ?? 1_000_000n
  }

  getBalance(): Promise<{ sats: Sats }> {
    return Promise.resolve({ sats: this.balance })
  }

  makeInvoice(input: { amountSats: Sats; memo: string; expirySeconds: number }): Promise<Invoice> {
    if (input.amountSats <= 0n) {
      return Promise.reject(new RailError(this.kind, "AMOUNT_OUT_OF_RANGE", "amount must be > 0"))
    }
    this.seq++
    const paymentHash = sha(`fake-invoice-${this.seq}`)
    const inv = {
      bolt11: `lnbc${input.amountSats}n1fake${this.seq}`,
      paymentHash,
      amountSats: input.amountSats,
      expiresAt: new Date(this.now().getTime() + input.expirySeconds * 1000).toISOString(),
      state: { state: "pending" as const },
    }
    this.invoices.set(paymentHash, inv)
    const { state: _s, ...pub } = inv
    return Promise.resolve(pub)
  }

  /** Test hook: mark one of our invoices paid. */
  settle(paymentHash: string): void {
    const inv = this.invoices.get(paymentHash)
    if (!inv) throw new RailError(this.kind, "NOT_FOUND", paymentHash)
    inv.state = {
      state: "settled",
      settledAt: this.now().toISOString(),
      preimage: sha(`pre-${paymentHash}`),
    }
    this.balance += inv.amountSats
  }

  lookupInvoice(paymentHash: string): Promise<InvoiceLookup> {
    const inv = this.invoices.get(paymentHash)
    if (!inv) return Promise.reject(new RailError(this.kind, "NOT_FOUND", paymentHash))
    if (inv.state.state === "pending" && inv.expiresAt <= this.now().toISOString()) {
      return Promise.resolve({ state: "expired" })
    }
    return Promise.resolve(inv.state)
  }

  payInvoice(input: {
    bolt11: string
    amountSats: Sats
    idempotencyKey: string
  }): Promise<Payment> {
    const prior = this.payments.get(input.idempotencyKey)
    if (prior) return Promise.resolve(prior)
    if (!input.bolt11.startsWith("lnbc")) {
      return Promise.reject(new RailError(this.kind, "REJECTED", "not a bolt11"))
    }
    if (input.bolt11.includes("fail")) {
      return Promise.reject(new RailError(this.kind, "REJECTED", "payment failed"))
    }
    if (input.amountSats <= 0n) {
      return Promise.reject(new RailError(this.kind, "AMOUNT_OUT_OF_RANGE", "amount must be > 0"))
    }
    const fee = input.amountSats / 1000n + 1n // ~0.1% + 1 sat, integer
    if (input.bolt11.includes("nofunds") || this.balance < input.amountSats + fee) {
      return Promise.reject(new RailError(this.kind, "INSUFFICIENT_FUNDS", "balance too low"))
    }
    this.balance -= input.amountSats + fee
    const paymentHash = sha(input.bolt11)
    const payment: Payment = {
      paymentHash,
      preimage: sha(`pre-${paymentHash}`),
      amountSats: input.amountSats,
      feeSats: fee,
    }
    this.payments.set(input.idempotencyKey, payment)
    return Promise.resolve(payment)
  }

  resolveAddress(address: string, amountSats: Sats): Promise<{ bolt11: string }> {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
      return Promise.reject(
        new RailError(this.kind, "REJECTED", `not a lightning address: ${address}`),
      )
    }
    return Promise.resolve({ bolt11: `lnbc${amountSats}n1addr${sha(address).slice(0, 12)}` })
  }
}

/** Fake exchange: fixed rate, quotes valid for `quoteTtlMs`, executes once per quote. */
export class FakeExchangeRail implements ExchangeRail {
  readonly kind = "fake-exchange"
  private readonly quotes = new Map<string, Quote>()
  private readonly executed = new Map<string, Execution>()
  private seq = 0

  constructor(
    private readonly opts: {
      usdCentsPerBtc?: Cents
      quoteTtlMs?: number
      balanceCents?: Cents
      now?: Clock
    } = {},
    private balanceCents: Cents = opts.balanceCents ?? 100_00n,
    private readonly now: Clock = opts.now ?? (() => new Date(0)),
  ) {}

  get rate(): Cents {
    return this.opts.usdCentsPerBtc ?? 8_316_900n
  }

  getRate(): Promise<{ usdCentsPerBtc: Cents; asOf: string }> {
    return Promise.resolve({ usdCentsPerBtc: this.rate, asOf: this.now().toISOString() })
  }

  createQuote(input: { usdCents: Cents }): Promise<Quote> {
    if (input.usdCents <= 0n) {
      return Promise.reject(new RailError(this.kind, "AMOUNT_OUT_OF_RANGE", "amount must be > 0"))
    }
    this.seq++
    const q: Quote = {
      id: `q_fake_${this.seq}`,
      usdCents: input.usdCents,
      sats: (input.usdCents * SATS_PER_BTC) / this.rate,
      usdCentsPerBtc: this.rate,
      expiresAt: new Date(this.now().getTime() + (this.opts.quoteTtlMs ?? 15_000)).toISOString(),
    }
    this.quotes.set(q.id, q)
    return Promise.resolve(q)
  }

  executeQuote(quoteId: string): Promise<Execution> {
    const done = this.executed.get(quoteId)
    if (done) return Promise.resolve(done)
    const q = this.quotes.get(quoteId)
    if (!q) return Promise.reject(new RailError(this.kind, "NOT_FOUND", quoteId))
    if (q.expiresAt <= this.now().toISOString()) {
      return Promise.reject(new RailError(this.kind, "EXPIRED", quoteId))
    }
    if (this.balanceCents < q.usdCents) {
      return Promise.reject(new RailError(this.kind, "INSUFFICIENT_FUNDS", "BALANCE_TOO_LOW"))
    }
    this.balanceCents -= q.usdCents
    const ex: Execution = {
      quoteId,
      sats: q.sats,
      usdCents: q.usdCents,
      executedAt: this.now().toISOString(),
    }
    this.executed.set(quoteId, ex)
    return Promise.resolve(ex)
  }
}

/** Fake merchant: two products; orders are delivered once their invoice is paid via `markPaid`. */
export class FakeGoodsRail implements GoodsRail {
  readonly kind = "fake-goods"
  private readonly orders = new Map<string, Order>()
  private seq = 0
  readonly products: Product[] = [
    { id: "gift-amazon-us", name: "Amazon.com gift card", usdCents: null },
    { id: "topup-mint-10", name: "Mint Mobile top-up $10", usdCents: 10_00n },
  ]

  /** When set, each `getOrder` after payment advances unpaid→paid→delivered automatically. */
  autoProgress = false
  private readonly polls = new Map<string, number>()

  constructor(private readonly usdCentsPerBtc: Cents = 8_316_900n) {}

  searchProducts(query: string): Promise<Product[]> {
    const q = query.toLowerCase()
    return Promise.resolve(this.products.filter((p) => p.name.toLowerCase().includes(q)))
  }

  createOrder(input: { productId: string; usdCents: Cents }): Promise<Order> {
    const p = this.products.find((x) => x.id === input.productId)
    if (!p) return Promise.reject(new RailError(this.kind, "NOT_FOUND", input.productId))
    if (p.usdCents !== null && p.usdCents !== input.usdCents) {
      return Promise.reject(new RailError(this.kind, "AMOUNT_OUT_OF_RANGE", "fixed-price product"))
    }
    this.seq++
    const amountSats = (input.usdCents * SATS_PER_BTC) / this.usdCentsPerBtc
    const order: Order = {
      orderId: `ord_fake_${this.seq}`,
      bolt11: `lnbc${amountSats}n1goods${this.seq}`,
      amountSats,
      state: "unpaid",
    }
    this.orders.set(order.orderId, order)
    return Promise.resolve(order)
  }

  getOrder(orderId: string): Promise<Order> {
    const o = this.orders.get(orderId)
    if (!o) return Promise.reject(new RailError(this.kind, "NOT_FOUND", orderId))
    if (this.autoProgress) {
      const n = (this.polls.get(orderId) ?? 0) + 1
      this.polls.set(orderId, n)
      if (n >= 1 && o.state === "unpaid") this.markPaid(orderId)
      if (n >= 2 && o.state === "paid") this.deliver(orderId)
    }
    return Promise.resolve({ ...o })
  }

  /** Test hook: payment observed. Delivery follows on the next `getOrder` after `deliver`. */
  markPaid(orderId: string): void {
    const o = this.orders.get(orderId)
    if (o) o.state = "paid"
  }

  deliver(orderId: string): void {
    const o = this.orders.get(orderId)
    if (o?.state === "paid") {
      o.state = "delivered"
      o.redemption = `FAKE-CODE-${sha(orderId).slice(0, 8).toUpperCase()}`
    }
  }
}
