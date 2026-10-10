import { RailError } from "@agentic-bitcoin/core"
import { SPEC_INVOICE } from "@agentic-bitcoin/fixtures"
import { describe, expect, it } from "vitest"
import {
  type NwcClientLike,
  NwcWalletRail,
  describeConnectionString,
  msatsToSats,
  msatsToSatsUp,
  redact,
  toRailError,
  validateConnectionString,
} from "./nwc"

const REAL_BOLT11 = SPEC_INVOICE.bolt11
const REAL_HASH = SPEC_INVOICE.paymentHash
const REAL_SATS = SPEC_INVOICE.amountSats
const PK = "a".repeat(64)
const SECRET = "b".repeat(64)
const NWC_URL = `nostr+walletconnect://${PK}?relay=wss://relay.example.com&secret=${SECRET}`

class FakeClient implements NwcClientLike {
  calls: string[] = []
  balanceMsats = 1_000_000_000
  settled = new Map<
    string,
    { preimage: string; amount: number; fees_paid: number; type: "incoming" | "outgoing" }
  >()
  payBehaviour: "ok" | "timeout" | "wallet-error" = "ok"
  walletErrorCode = "INSUFFICIENT_BALANCE"
  async getBalance() {
    this.calls.push("get_balance")
    return { balance: this.balanceMsats }
  }
  async makeInvoice(req: { amount: number; description?: string; expiry?: number }) {
    this.calls.push(`make_invoice ${req.amount}`)
    return {
      invoice: "lnbc1fakefromwallet",
      payment_hash: "c".repeat(64),
      expires_at: 1_800_000_000,
    }
  }
  async payInvoice(req: { invoice: string; amount?: number }) {
    this.calls.push(`pay_invoice ${req.amount ?? ""}`.trim())
    if (this.payBehaviour === "timeout") {
      const e = new Error("reply timeout")
      e.name = "Nip47ReplyTimeoutError"
      throw e
    }
    if (this.payBehaviour === "wallet-error") {
      const e = new Error("not enough") as Error & { code: string }
      e.name = "Nip47WalletError"
      e.code = this.walletErrorCode
      throw e
    }
    this.balanceMsats -= req.amount ?? Number(REAL_SATS) * 1000
    return { preimage: "d".repeat(64), fees_paid: 1_501 }
  }
  async lookupInvoice(req: { payment_hash?: string }) {
    this.calls.push(`lookup_invoice ${req.payment_hash?.slice(0, 4)}`)
    const s = req.payment_hash ? this.settled.get(req.payment_hash) : undefined
    if (!s) {
      const e = new Error("not found") as Error & { code: string }
      e.name = "Nip47WalletError"
      e.code = "NOT_FOUND"
      throw e
    }
    return {
      type: s.type,
      state: "settled" as const,
      preimage: s.preimage,
      settled_at: 1_800_000_000,
      amount: s.amount,
      fees_paid: s.fees_paid,
    }
  }
  getWalletServiceInfo?: () => Promise<{ capabilities?: string[] }>
  async getInfo() {
    return { alias: "test-hub", network: "signet", methods: ["pay_invoice"] }
  }
  async getBudget() {
    return { used_budget: 21_000, total_budget: 10_000_000, renewal_period: "daily" }
  }
}

const make = (client = new FakeClient()) => ({
  client,
  rail: new NwcWalletRail({
    client,
    now: () => new Date(0),
    sleep: async () => {},
    settleTimeoutMs: 0,
  }),
})

describe("units", () => {
  it("msats → sats floors, fees round up", () => {
    expect(msatsToSats(1_999)).toBe(1n)
    expect(msatsToSatsUp(1_001)).toBe(2n)
    expect(msatsToSatsUp(0)).toBe(0n)
    expect(msatsToSatsUp(3_000)).toBe(3n)
  })
  it("balance is whole sats", async () => {
    const { rail } = make()
    expect(await rail.getBalance()).toEqual({ sats: 1_000_000n })
  })
})

describe("makeInvoice", () => {
  it("sends msats and returns the wallet's bolt11, hash and expiry", async () => {
    const { rail, client } = make()
    const inv = await rail.makeInvoice({ amountSats: 1_000n, memo: "coffee", expirySeconds: 600 })
    expect(client.calls).toEqual(["make_invoice 1000000"])
    expect(inv).toEqual({
      bolt11: "lnbc1fakefromwallet",
      paymentHash: "c".repeat(64),
      amountSats: 1_000n,
      expiresAt: "2027-01-15T08:00:00.000Z",
    })
  })
  it("rejects zero", async () => {
    const { rail } = make()
    await expect(
      rail.makeInvoice({ amountSats: 0n, memo: "", expirySeconds: 1 }),
    ).rejects.toMatchObject({ code: "AMOUNT_OUT_OF_RANGE" })
  })
})

describe("payInvoice", () => {
  it("decodes the invoice, pays it, converts fees up, and is idempotent", async () => {
    const { rail, client } = make()
    const p = await rail.payInvoice({
      bolt11: REAL_BOLT11,
      amountSats: REAL_SATS,
      idempotencyKey: "k1",
    })
    expect(p).toEqual({
      paymentHash: REAL_HASH,
      preimage: "d".repeat(64),
      amountSats: REAL_SATS,
      feeSats: 2n,
    })
    const again = await rail.payInvoice({
      bolt11: REAL_BOLT11,
      amountSats: REAL_SATS,
      idempotencyKey: "k1",
    })
    expect(again).toBe(p)
    expect(client.calls.filter((c) => c.startsWith("pay_invoice"))).toHaveLength(1)
  })
  it("refuses an invoice whose amount differs from the approved amount, before any wallet call", async () => {
    const { rail, client } = make()
    await expect(
      rail.payInvoice({ bolt11: REAL_BOLT11, amountSats: 21n, idempotencyKey: "k2" }),
    ).rejects.toMatchObject({
      code: "AMOUNT_OUT_OF_RANGE",
    })
    expect(client.calls).toEqual([])
  })
  it("refuses junk and zero amounts", async () => {
    const { rail } = make()
    await expect(
      rail.payInvoice({ bolt11: "lnbc-not-real", amountSats: 1n, idempotencyKey: "k3" }),
    ).rejects.toMatchObject({ code: "REJECTED" })
    await expect(
      rail.payInvoice({ bolt11: REAL_BOLT11, amountSats: 0n, idempotencyKey: "k4" }),
    ).rejects.toMatchObject({ code: "AMOUNT_OUT_OF_RANGE" })
  })
  it("returns the stored preimage without paying when the wallet already settled this hash", async () => {
    const client = new FakeClient()
    client.settled.set(REAL_HASH, {
      preimage: "e".repeat(64),
      amount: 250_000_000,
      fees_paid: 500,
      type: "outgoing",
    })
    const { rail } = make(client)
    const p = await rail.payInvoice({
      bolt11: REAL_BOLT11,
      amountSats: REAL_SATS,
      idempotencyKey: "k5",
    })
    expect(p.preimage).toBe("e".repeat(64))
    expect(client.calls.some((c) => c.startsWith("pay_invoice"))).toBe(false)
  })
  it("does not mistake an INCOMING settled invoice for our own payment", async () => {
    const client = new FakeClient()
    client.settled.set(REAL_HASH, {
      preimage: "e".repeat(64),
      amount: 250_000_000,
      fees_paid: 0,
      type: "incoming",
    })
    const { rail } = make(client)
    const p = await rail.payInvoice({
      bolt11: REAL_BOLT11,
      amountSats: REAL_SATS,
      idempotencyKey: "k6",
    })
    expect(p.preimage).toBe("d".repeat(64)) // actually paid
  })
  it("after a timeout, recovers the payment if lookup shows it settled", async () => {
    const client = new FakeClient()
    client.payBehaviour = "timeout"
    let polls = 0
    const orig = client.lookupInvoice.bind(client)
    client.lookupInvoice = async (req) => {
      polls++
      if (polls === 2)
        client.settled.set(REAL_HASH, {
          preimage: "f".repeat(64),
          amount: 250_000_000,
          fees_paid: 1000,
          type: "outgoing",
        })
      return orig(req)
    }
    let t = 0
    const tick = () => {
      t += 1000
      return new Date(t)
    }
    const rail = new NwcWalletRail({
      client,
      now: tick,
      sleep: async () => {},
      settleTimeoutMs: 10_000,
      pollIntervalMs: 1,
    })
    const p = await rail.payInvoice({
      bolt11: REAL_BOLT11,
      amountSats: REAL_SATS,
      idempotencyKey: "k7",
    })
    expect(p.preimage).toBe("f".repeat(64))
    expect(p.feeSats).toBe(1n)
  })
  it("after a timeout with no settlement, throws UNKNOWN_STATE (never a plain failure)", async () => {
    const client = new FakeClient()
    client.payBehaviour = "timeout"
    const { rail } = make(client)
    await expect(
      rail.payInvoice({ bolt11: REAL_BOLT11, amountSats: REAL_SATS, idempotencyKey: "k8" }),
    ).rejects.toMatchObject({
      code: "UNKNOWN_STATE",
    })
  })
  it("maps NIP-47 wallet errors to typed codes", async () => {
    const client = new FakeClient()
    client.payBehaviour = "wallet-error"
    const { rail } = make(client)
    await expect(
      rail.payInvoice({ bolt11: REAL_BOLT11, amountSats: REAL_SATS, idempotencyKey: "k9" }),
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_FUNDS",
    })
    client.walletErrorCode = "QUOTA_EXCEEDED"
    await expect(
      rail.payInvoice({ bolt11: REAL_BOLT11, amountSats: REAL_SATS, idempotencyKey: "k10" }),
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_FUNDS",
    })
    client.walletErrorCode = "RESTRICTED"
    await expect(
      rail.payInvoice({ bolt11: REAL_BOLT11, amountSats: REAL_SATS, idempotencyKey: "k11" }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    })
  })
})

describe("lookupInvoice and connection info", () => {
  it("maps states", async () => {
    const client = new FakeClient()
    client.settled.set("1".repeat(64), {
      preimage: "p".repeat(64),
      amount: 1000,
      fees_paid: 0,
      type: "incoming",
    })
    const { rail } = make(client)
    expect(await rail.lookupInvoice("1".repeat(64))).toMatchObject({
      state: "settled",
      preimage: "p".repeat(64),
    })
    await expect(rail.lookupInvoice("2".repeat(64))).rejects.toMatchObject({ code: "NOT_FOUND" })
  })
  it("describes a wallet that stays silent on get_info/get_budget (e.g. Coinos) instead of timing out", async () => {
    const client = new FakeClient()
    client.getWalletServiceInfo = async () => ({
      capabilities: [
        "get_balance",
        "pay_invoice",
        "make_invoice",
        "lookup_invoice",
        "notifications",
      ],
    })
    client.getInfo = async () => {
      throw new Error("never answers")
    }
    client.getBudget = async () => {
      throw new Error("never answers")
    }
    const { rail } = make(client)
    expect(await rail.describeConnection()).toEqual({
      alias: undefined,
      network: undefined,
      methods: ["get_balance", "pay_invoice", "make_invoice", "lookup_invoice"],
      budget: undefined,
    })
  })
  it("describes the connection with a budget in sats", async () => {
    const { rail } = make()
    expect(await rail.describeConnection()).toEqual({
      alias: "test-hub",
      network: "signet",
      methods: ["pay_invoice"],
      budget: { usedSats: 21n, totalSats: 10_000n, renewal: "daily" },
    })
  })
})

describe("resolveAddress", () => {
  it("validates shape and delegates to the injected resolver", async () => {
    const client = new FakeClient()
    const rail = new NwcWalletRail({
      client,
      resolveAddress: async (a, s) => ({ bolt11: `lnbc-${a}-${s}` }),
    })
    expect(await rail.resolveAddress("gm@getalby.com", 21n)).toEqual({
      bolt11: "lnbc-gm@getalby.com-21",
    })
    await expect(rail.resolveAddress("nope", 21n)).rejects.toBeInstanceOf(RailError)
  })
})

describe("secrets never leak", () => {
  it("validates and describes a connection string without the secret", () => {
    expect(validateConnectionString(NWC_URL)).toEqual({
      walletPubkey: PK,
      relayUrls: ["wss://relay.example.com"],
      hasSecret: true,
    })
    const d = describeConnectionString(NWC_URL)
    expect(d).toBe("nwc aaaaaaaa… via wss://relay.example.com")
    expect(d).not.toContain(SECRET)
  })
  it("rejects strings without a secret or relay, and non-NWC strings", () => {
    expect(() => validateConnectionString(`nostr+walletconnect://${PK}?relay=wss://r`)).toThrow(
      RailError,
    )
    expect(() => validateConnectionString(`nostr+walletconnect://${PK}?secret=${SECRET}`)).toThrow(
      RailError,
    )
    expect(() => validateConnectionString("https://example.com")).toThrow(RailError)
  })
  it("redacts secrets and keys inside error messages", () => {
    const e = new Error(`failed for ${NWC_URL}`)
    e.name = "Nip47NetworkError"
    const r = toRailError(e)
    expect(r.code).toBe("UNREACHABLE")
    expect(r.message).not.toContain(SECRET)
    expect(r.message).not.toContain(PK)
    expect(redact(`key ${PK} and secret=${SECRET}`)).toBe("key aaaaaaaa… and secret=[redacted]")
  })
  it("requires a client or a connection string", () => {
    expect(() => new NwcWalletRail({})).toThrow(RailError)
  })
})
