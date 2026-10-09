import {
  InMemoryPendingStore,
  type LlmClient,
  type LlmResponse,
  type UserContext,
} from "@agentic-bitcoin/agent"
import { FakeWalletRail, InMemoryLedgerStore } from "@agentic-bitcoin/core"
import { PRICE, clockAt } from "@agentic-bitcoin/fixtures"
import { decryptSecret, parseKey } from "@agentic-bitcoin/rails"
import { describe, expect, it } from "vitest"
import { Dispatcher } from "./dispatcher"
import type { WalletProbe } from "./onboarding"
import { InMemoryHistoryStore, InMemoryPolicyStore, InMemorySecretStore } from "./store/stores"
import { FakeSurface } from "./surfaces/surface"

const PK = "a".repeat(64)
const SECRET = "b".repeat(64)
const NWC = `nostr+walletconnect://${PK}?relay=wss://relay.example.com&secret=${SECRET}`
const KEY = parseKey("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")

const idleLlm: LlmClient = {
  async complete(): Promise<LlmResponse> {
    return {
      stop_reason: "end_turn",
      content: [{ type: "text", text: "model saw it", citations: null }],
    }
  },
}

function setup(
  opts: { probe?: WalletProbe | Error; secretsKey?: Buffer | null; inviteCode?: string } = {},
) {
  const surface = new FakeSurface()
  const policies = new InMemoryPolicyStore()
  const secrets = new InMemorySecretStore()
  const changed: string[] = []
  const probeResult = opts.probe ?? {
    alias: "hub",
    methods: ["get_balance", "make_invoice", "pay_invoice", "lookup_invoice"],
    budget: { usedSats: 0n, totalSats: 10_000n, renewal: "daily" },
  }
  const d = new Dispatcher({
    surface,
    agent: { llm: idleLlm, price: async () => PRICE, now: clockAt() },
    resolveContext: async (userId): Promise<UserContext> => ({
      userId,
      policy: (await policies.get(userId)) ?? {
        dailyCapSats: 1n,
        perActionCapSats: 1n,
        confirmAboveSats: 1n,
        allowDestinations: [],
        denyDestinations: [],
        coldStorageAddresses: [],
        killSwitch: false,
        rails: { wallet: true, exchange: false, goods: false, compute: false, onchain: false },
      },
      ledger: new InMemoryLedgerStore(),
      rails: { wallet: new FakeWalletRail() },
      pending: new InMemoryPendingStore(),
    }),
    policies,
    history: new InMemoryHistoryStore(),
    secrets,
    secretsKey: opts.secretsKey === undefined ? KEY : opts.secretsKey,
    probeWallet: async () => {
      if (probeResult instanceof Error) throw probeResult
      return probeResult
    },
    onCredentialsChanged: (u) => changed.push(u),
    inviteCode: opts.inviteCode,
    now: clockAt(),
  })
  const last = () => surface.sent.at(-1)?.m.text ?? ""
  return { surface, policies, secrets, changed, d, last }
}

describe("first-run wizard", () => {
  it("/start with no policy walks three questions and stores the result", async () => {
    const { surface, policies, d, last } = setup()
    await d.start()
    await surface.receive({ userId: "u", text: "/start" })
    expect(last()).toContain("1/3")
    await surface.receive({ userId: "u", text: "20000" })
    expect(last()).toContain("2/3")
    await surface.receive({ userId: "u", text: "5000" })
    expect(last()).toContain("3/3")
    await surface.receive({ userId: "u", text: "wallet, compute" })
    expect(last()).toContain("Done")
    expect(await policies.get("u")).toMatchObject({
      dailyCapSats: 20_000n,
      confirmAboveSats: 5_000n,
      rails: { wallet: true, compute: true, exchange: false, goods: false },
    })
    await surface.receive({ userId: "u", text: "/start" })
    expect(last()).toContain("/pair") // second /start is help, not the wizard
  })
  it("plain text during the wizard is a wizard answer, never a model turn; /kill aborts it", async () => {
    const { surface, d, last } = setup()
    await d.start()
    await surface.receive({ userId: "u", text: "/setup" })
    await surface.receive({ userId: "u", text: "pay someone 500 sats" })
    expect(last()).toContain("whole number")
    await surface.receive({ userId: "u", text: "/kill" })
    await surface.receive({ userId: "u", text: "hello" })
    expect(last()).toBe("model saw it")
  })
})

describe("first contact (Signal users never type /start)", () => {
  it("greets a new number and starts the wizard on any first message", async () => {
    const { surface, policies, d, last } = setup()
    await d.start()
    await surface.receive({ userId: "signal:+15552223333", text: "hi there" })
    expect(last()).toContain("Glad you're here")
    expect(last()).toContain("1/3")
    await surface.receive({ userId: "signal:+15552223333", text: "20000" })
    await surface.receive({ userId: "signal:+15552223333", text: "5000" })
    await surface.receive({ userId: "signal:+15552223333", text: "wallet" })
    expect((await policies.get("signal:+15552223333"))?.dailyCapSats).toBe(20_000n)
    await surface.receive({ userId: "signal:+15552223333", text: "hello again" })
    expect(last()).toBe("model saw it") // a known user goes to the model
  })
  it("with an invite code, strangers get the waitlist message until they send the code", async () => {
    const { surface, d, last } = setup({ inviteCode: "SATS-2026" })
    await d.start()
    await surface.receive({ userId: "signal:+15559998888", text: "hey" })
    expect(last()).toContain("invite code")
    expect(last()).not.toContain("1/3")
    await surface.receive({ userId: "signal:+15559998888", text: "sats-2026" })
    expect(last()).toContain("1/3")
  })
})

describe("/pair", () => {
  it("stores a budgeted connection encrypted, redacts the message, rebuilds rails", async () => {
    const { surface, secrets, changed, d, last } = setup()
    await d.start()
    await surface.receive({ userId: "u", text: `/pair ${NWC}`, messageId: "m1" })
    expect(last()).toMatch(/^Paired hub\. Wallet budget 10,000 sats daily/)
    expect(surface.redacted).toEqual(["m1"])
    const blob = await secrets.get("u", "nwc")
    expect(blob).not.toContain(SECRET)
    expect(decryptSecret(blob as string, KEY)).toBe(NWC)
    expect(changed).toEqual(["u"])
    await surface.receive({ userId: "u", text: "/unpair" })
    expect(await secrets.get("u", "nwc")).toBeNull()
  })
  it("refuses an unbudgeted connection, accepts it only with the explicit override", async () => {
    const { surface, secrets, d, last } = setup({ probe: { alias: "hub", budget: null } })
    await d.start()
    await surface.receive({ userId: "u", text: `/pair ${NWC}` })
    expect(last()).toContain("NO budget")
    expect(await secrets.get("u", "nwc")).toBeNull()
    await surface.receive({ userId: "u", text: `/pair unbudgeted ${NWC}` })
    expect(last()).toContain("NONE (you overrode")
    expect(await secrets.get("u", "nwc")).not.toBeNull()
  })
  it("rejects junk strings and unreachable wallets without storing anything", async () => {
    const { surface, secrets, d, last } = setup({ probe: new Error("relay timeout") })
    await d.start()
    await surface.receive({ userId: "u", text: "/pair https://example.com" })
    expect(last()).toContain("Not a usable connection string")
    await surface.receive({ userId: "u", text: `/pair ${NWC}` })
    expect(last()).toContain("could not reach")
    expect(await secrets.get("u", "nwc")).toBeNull()
    await surface.receive({ userId: "u", text: "/pair" })
    expect(last()).toContain("Alby Hub")
  })
  it("is disabled without a server secrets key", async () => {
    const { surface, d, last } = setup({ secretsKey: null })
    await d.start()
    await surface.receive({ userId: "u", text: `/pair ${NWC}` })
    expect(last()).toContain("disabled")
  })
})

describe("/cold", () => {
  it("registers a valid address into the allow list and rejects junk", async () => {
    const { surface, policies, d, last } = setup()
    await d.start()
    await surface.receive({ userId: "u", text: "/cold" })
    expect(last()).toContain("No cold-storage address yet")
    await surface.receive({ userId: "u", text: "/cold bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4" })
    expect(last()).toContain("Registered p2wpkh address on mainnet")
    expect(last()).toContain("/budget rail onchain on")
    expect((await policies.get("u"))?.coldStorageAddresses).toEqual([
      "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
    ])
    await surface.receive({ userId: "u", text: "/cold bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5" })
    expect(last()).toContain("not a valid bitcoin address")
    await surface.receive({
      userId: "u",
      text: "/cold remove bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
    })
    expect((await policies.get("u"))?.coldStorageAddresses).toEqual([])
  })
})

describe("/key and secret interception", () => {
  it("stores, masks, and removes API keys; never shows the full key", async () => {
    const { surface, secrets, d, last } = setup()
    await d.start()
    const k = "strike-live-abcdefghijklmnopqrstuvwxyz"
    await surface.receive({ userId: "u", text: `/key strike ${k}`, messageId: "m9" })
    expect(last()).toContain("strike key stored (stri…wxyz)")
    expect(last()).toContain("/budget rail exchange on")
    expect(surface.redacted).toEqual(["m9"])
    expect(decryptSecret((await secrets.get("u", "strike")) as string, KEY)).toBe(k)
    await surface.receive({ userId: "u", text: "/key" })
    expect(last()).toContain("strike: stri…wxyz")
    expect(last()).toContain("bitrefill: not set")
    expect(last()).not.toContain(k)
    await surface.receive({ userId: "u", text: "/key strike remove" })
    expect(await secrets.get("u", "strike")).toBeNull()
    await surface.receive({ userId: "u", text: "/key coinbase x" })
    expect(last()).toContain("Usage")
  })
  it("a bare connection string in chat never reaches the model", async () => {
    const { surface, d, last } = setup()
    await d.start()
    await surface.receive({ userId: "u", text: `here you go ${NWC}`, messageId: "m2" })
    expect(last()).toContain("never pass those to the model")
    expect(surface.redacted).toEqual(["m2"])
    expect(surface.sent.some((s) => s.m.text === "model saw it")).toBe(false)
  })
})
