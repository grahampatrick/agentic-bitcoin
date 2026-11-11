/**
 * M25 (ADR-0029): everything a slash command did, said in plain words.
 *
 * The model is scripted: each `complete()` call plays the next step, so these tests pin what the
 * code does around the model — what it lets through, what it holds for a yes, and what it never
 * lets the model see at all.
 */
import {
  InMemoryPendingStore,
  type LlmClient,
  type LlmResponse,
  type UserContext,
} from "@agentic-bitcoin/agent"
import {
  FakeWalletRail,
  InMemoryLedgerStore,
  InMemoryWebLinkStore,
  type Policy,
  readEntries,
} from "@agentic-bitcoin/core"
import { POLICIES, PRICE, clockAt } from "@agentic-bitcoin/fixtures"
import { decryptSecret, parseKey } from "@agentic-bitcoin/rails"
import { describe, expect, it } from "vitest"
import { Dispatcher, HELP } from "./dispatcher"
import { looksLikeSecret } from "./onboarding"
import type { WalletProbe } from "./onboarding"
import { InMemoryHistoryStore, InMemoryPolicyStore, InMemorySecretStore } from "./store/stores"
import { FakeSurface } from "./surfaces/surface"

const KEY = parseKey("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
const NWC = `nostr+walletconnect://${"a".repeat(64)}?relay=wss://relay.example.com&secret=${"b".repeat(64)}`
const API_KEY = "JMRJluDcSiEvcEtP93KcHCa7QwErTyUiOpAsDfVbTY12"

type Step = string | { name: string; input: Record<string, unknown> }

/** Plays one step per model call and records everything the model was shown. */
function script(steps: Step[]) {
  const seen: string[] = []
  let i = 0
  const llm: LlmClient = {
    async complete(req): Promise<LlmResponse> {
      seen.push(JSON.stringify(req.messages))
      const step = steps[i++] ?? "ok"
      if (typeof step === "string")
        return { stop_reason: "end_turn", content: [{ type: "text", text: step, citations: null }] }
      return {
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: `tu_${i}`, name: step.name, input: step.input }],
      }
    },
  }
  return { llm, seen, calls: () => i }
}

const START: Policy = {
  ...POLICIES.open,
  dailyCapSats: 100_000n,
  perActionCapSats: 50_000n,
  confirmAboveSats: 10_000n,
  rails: { ...POLICIES.open.rails, exchange: false },
}

function setup(steps: Step[] = [], opts: { probe?: WalletProbe } = {}) {
  const surface = new FakeSurface()
  const policies = new InMemoryPolicyStore()
  const secrets = new InMemorySecretStore()
  const history = new InMemoryHistoryStore()
  const ledger = new InMemoryLedgerStore()
  const pending = new InMemoryPendingStore()
  const wallet = new FakeWalletRail({ balanceSats: 100_000n })
  const webLinks = new InMemoryWebLinkStore()
  const model = script(steps)
  void policies.set("u", START)
  const d = new Dispatcher({
    surface,
    agent: { llm: model.llm, price: async () => PRICE, now: clockAt() },
    resolveContext: async (userId): Promise<UserContext> => ({
      userId,
      policy: (await policies.get(userId)) ?? START,
      ledger,
      rails: { wallet },
      pending,
    }),
    policies,
    history,
    secrets,
    secretsKey: KEY,
    probeWallet: async () =>
      opts.probe ?? {
        alias: "hub",
        methods: ["get_balance", "make_invoice", "pay_invoice", "lookup_invoice"],
        budget: { usedSats: 0n, totalSats: 10_000n, renewal: "daily" },
      },
    siteUrl: "https://anvard.test",
    webLinks: { store: webLinks, newToken: () => "tok_secret_bearer_0123456789" },
    now: clockAt(),
  })
  const say = async (text: string, messageId?: string) => {
    await surface.receive({ userId: "u", text, messageId })
    return surface.sent.at(-1)?.m.text ?? ""
  }
  const policy = async () => (await policies.get("u")) as Policy
  return { surface, d, say, policy, policies, secrets, history, ledger, pending, wallet, model }
}

const change = (setting: string, op: string, value = "", name = "") => ({
  name: "change_setting",
  input: { setting, op, value, name },
})

describe("help", () => {
  it("is three sentences and teaches no command", () => {
    expect(HELP.split(/(?<=[.?!”])\s+(?=[A-Z])/).length).toBeLessThanOrEqual(3)
    expect(HELP).not.toContain("/")
  })
})

describe("secrets never reach the model", () => {
  it("a pasted connection string connects the wallet", async () => {
    const s = setup()
    await s.d.start()
    expect(await s.say(NWC, "m1")).toContain("Paired hub")
    expect(s.surface.redacted).toEqual(["m1"])
    expect(decryptSecret((await s.secrets.get("u", "nwc")) as string, KEY)).toBe(NWC)
    expect(s.model.calls()).toBe(0)
  })

  it("a connection with no budget is refused, held for one answer, and connected only on “connect anyway”", async () => {
    const probe = { alias: "hub", methods: undefined, budget: null }
    const s = setup([], { probe })
    await s.d.start()
    expect(await s.say(NWC)).toContain("reply “connect anyway”")
    expect(await s.secrets.get("u", "nwc")).toBeNull()
    expect(await s.say("connect anyway")).toContain("Paired hub")
    expect(await s.secrets.get("u", "nwc")).not.toBeNull()

    // any other answer forgets the string: a later "connect anyway" has nothing to connect
    const t = setup(["a model reply"], { probe })
    await t.d.start()
    await t.say(NWC)
    await t.say("what's my balance?")
    expect(await t.say("connect anyway")).toBe("ok")
    expect(await t.secrets.get("u", "nwc")).toBeNull()
  })

  it("a key is stored under the name in the message, or the answer to one question", async () => {
    const s = setup()
    await s.d.start()
    expect(await s.say(`my strike key is ${API_KEY}`, "m1")).toContain("Strike key stored")
    expect(decryptSecret((await s.secrets.get("u", "strike")) as string, KEY)).toBe(API_KEY)

    expect(await s.say(API_KEY, "m2")).toContain("Reply “strike” or “bitrefill”")
    expect(await s.secrets.get("u", "bitrefill")).toBeNull()
    expect(await s.say("Bitrefill")).toContain("Bitrefill key stored")
    expect(decryptSecret((await s.secrets.get("u", "bitrefill")) as string, KEY)).toBe(API_KEY)
    expect(s.surface.redacted).toEqual(["m1", "m2"])
    expect(s.model.calls()).toBe(0)
    for (const sent of s.surface.sent) expect(sent.m.text).not.toContain(API_KEY)
  })

  it("a held key is forgotten when the next message is anything else", async () => {
    const s = setup(["a model reply", "another"])
    await s.d.start()
    await s.say(API_KEY)
    expect(await s.say("never mind")).toBe("a model reply")
    expect(await s.say("strike")).toBe("another")
    expect(await s.secrets.get("u", "strike")).toBeNull()
  })

  it("“connect Strike” arms the next paste, and the key itself is never in what the model saw", async () => {
    const s = setup([
      { name: "show", input: { view: "connect_strike", arg: "" } },
      "Paste it here.",
    ])
    await s.d.start()
    expect(await s.say("connect strike")).toBe("Paste it here.")
    expect(await s.say(API_KEY, "m3")).toContain("Strike key stored")
    expect(decryptSecret((await s.secrets.get("u", "strike")) as string, KEY)).toBe(API_KEY)
    expect(s.model.seen.join("")).not.toContain(API_KEY)
    expect(JSON.stringify(await s.history.get("u"))).not.toContain(API_KEY)
  })

  it("an invoice, an LNURL, a bitcoin address and a link are not secrets; keys and connection strings are", () => {
    expect(looksLikeSecret(`pay lnbc20u1p${"q".repeat(180)}`)).toBe(false)
    expect(looksLikeSecret(`lightning:LNURL1DP68GURN8GHJ7${"A".repeat(60)}`)).toBe(false)
    expect(
      looksLikeSecret("my cold storage address is bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"),
    ).toBe(false)
    expect(
      looksLikeSecret(
        "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr is my taproot address",
      ),
    ).toBe(false)
    expect(looksLikeSecret(`pay https://anvard.test/pay/${"t".repeat(48)}`)).toBe(false)
    expect(looksLikeSecret(API_KEY)).toBe(true)
    expect(looksLikeSecret(NWC)).toBe(true)
    expect(looksLikeSecret(`lnbc1 and also ${API_KEY}`)).toBe(true)
  })
})

describe("stop everything", () => {
  it("is a fast path: the kill switch goes on with no model call, and what was waiting is dropped", async () => {
    const s = setup([change("daily_cap", "set", "900000"), "Reply yes to raise it."])
    await s.d.start()
    await s.say("raise my daily cap to 900k")
    expect(await s.pending.latest("u")).not.toBeNull()
    const calls = s.model.calls()
    expect(await s.say("Stop everything!")).toBe("Stopped. Nothing moves until you say “resume”.")
    expect(s.model.calls()).toBe(calls)
    expect((await s.policy()).killSwitch).toBe(true)
    expect(await s.pending.latest("u")).toBeNull()
    expect((await s.policy()).dailyCapSats).toBe(100_000n)
  })

  it("a bare “stop” cancels what is waiting; with nothing waiting it stops everything", async () => {
    const s = setup([change("rail", "on", "exchange"), "Reply yes."])
    await s.d.start()
    await s.say("turn on buying bitcoin")
    expect(await s.say("stop")).toBe("Cancelled. Nothing was sent.")
    expect((await s.policy()).killSwitch).toBe(false)
    expect(await s.say("stop")).toContain("Stopped.")
    expect((await s.policy()).killSwitch).toBe(true)
  })

  it("resume goes through the model, and only the person's own yes lifts it", async () => {
    const s = setup([
      change("kill_switch", "off"),
      // the model tries to approve its own proposal with the hash it was given
      { name: "confirm_action", input: { action_hash: "__HASH__" } },
      "Reply yes to lift the kill switch.",
    ])
    // feed the real hash into the scripted confirm_action once the first tool result exists
    const inner = s.model.llm.complete.bind(s.model.llm)
    s.model.llm.complete = async (req) => {
      const res = await inner(req)
      const use = res.content.find((b) => b.type === "tool_use")
      if (use && use.type === "tool_use" && use.name === "confirm_action") {
        const hash = /"action_hash\\?":\\?"([0-9a-f]{64})/.exec(JSON.stringify(req.messages))?.[1]
        use.input = { action_hash: hash ?? "" }
      }
      return res
    }
    await s.d.start()
    await s.say("stop everything")
    const reply = await s.say("resume")
    expect(reply).toBe("Reply yes to lift the kill switch.")
    expect((await s.policy()).killSwitch).toBe(true) // the model's confirm_action did nothing
    expect(s.model.seen.at(-1)).toContain("needs_user_confirmation")
    expect(await s.say("yes")).toBe("Done. The kill switch is off. Your limits still apply.")
    expect((await s.policy()).killSwitch).toBe(false)
  })
})

describe("settings in plain words", () => {
  it("a narrower limit applies at once, and the rest of the turn runs under it", async () => {
    const s = setup([
      change("per_action_cap", "set", "100"),
      {
        name: "pay_lightning_address",
        input: { address: "gm@getalby.com", amount_sats: 5_000, memo: "" },
      },
      "Your cap is 100 sats now, so that payment was refused.",
    ])
    await s.d.start()
    await s.say("set my per-payment cap to 100 sats, then pay gm 5000")
    expect((await s.policy()).perActionCapSats).toBe(100n)
    expect((await s.wallet.getBalance()).sats).toBe(100_000n)
    const outcomes = (await readEntries(s.ledger)).map((e) => `${e.action.kind}:${e.outcome}`)
    expect(outcomes).toEqual(["change_setting:succeeded", "pay_address:denied"])
  })

  it("a wider limit waits for a yes; no leaves everything as it was", async () => {
    const s = setup([change("daily_cap", "set", "500,000 sats"), "Reply yes or no."])
    await s.d.start()
    await s.say("raise my daily cap to 500k")
    const asked = s.surface.sent.at(-1)
    expect(asked?.m.confirm?.actionHash).toMatch(/^[0-9a-f]{64}$/)
    expect((await s.policy()).dailyCapSats).toBe(100_000n)
    expect(await s.say("no")).toBe("Cancelled. Nothing was sent.")
    expect((await s.policy()).dailyCapSats).toBe(100_000n)

    const t = setup([change("daily_cap", "set", "500000"), "Reply yes or no."])
    await t.d.start()
    await t.say("raise my daily cap to 500k")
    expect(await t.say("Go ahead")).toBe("Done. Your daily cap is now 500,000 sats.")
    expect((await t.policy()).dailyCapSats).toBe(500_000n)
  })

  it("a change that cannot be made is refused before anyone is asked", async () => {
    const s = setup([change("daily_cap", "set", "a lot"), "That needs a number."])
    await s.d.start()
    await s.say("set my daily cap to a lot")
    expect(await s.pending.latest("u")).toBeNull()
    expect(s.model.seen.at(-1)).toContain("whole number of sats")
    expect(await readEntries(s.ledger)).toEqual([])
  })

  it("blocking a destination is instant; unblocking it waits", async () => {
    const s = setup([
      change("deny_destination", "add", "*@evil.example"),
      "Blocked.",
      change("deny_destination", "remove", "*@evil.example"),
      "Reply yes to unblock.",
    ])
    await s.d.start()
    await s.say("never pay anyone at evil.example")
    expect((await s.policy()).denyDestinations).toEqual(["*@evil.example"])
    await s.say("actually unblock them")
    expect((await s.policy()).denyDestinations).toEqual(["*@evil.example"])
    expect(await s.say("yes")).toBe("Done. Unblocked *@evil.example.")
    expect((await s.policy()).denyDestinations).toEqual([])
  })
})

describe("views in plain words", () => {
  it("limits and activity come back as text the model can answer from", async () => {
    const s = setup([
      { name: "show", input: { view: "limits", arg: "" } },
      "Your daily cap is 100,000 sats.",
      { name: "show", input: { view: "activity", arg: "" } },
      "Nothing yet.",
    ])
    await s.d.start()
    expect(await s.say("what are my limits?")).toBe("Your daily cap is 100,000 sats.")
    expect(s.model.seen.at(-1)).toContain("Daily cap 100,000 sats")
    expect(s.model.seen.at(-1)).not.toMatch(/\/budget|\/kill/)
    await s.say("what did I spend today?")
    // looking is not activity: the earlier view never shows up in the activity list
    const shown = JSON.stringify((JSON.parse(s.model.seen.at(-1) ?? "[]") as unknown[]).at(-1))
    expect(shown).toContain("Last 24h: 0 sats")
    expect(shown).toContain("No actions yet.")
  })

  it("the workspace link goes to the person, never to the model or the history", async () => {
    const s = setup([{ name: "show", input: { view: "workspace_link", arg: "" } }, "Sent."])
    await s.d.start()
    await s.say("open my account on the web")
    const texts = s.surface.sent.map((x) => x.m.text)
    expect(texts.at(-2)).toBe("Sent.")
    expect(texts.at(-1)).toContain("https://anvard.test/me?t=tok_secret_bearer_0123456789")
    expect(s.model.seen.join("")).not.toContain("tok_secret_bearer")
    expect(JSON.stringify(await s.history.get("u"))).not.toContain("tok_secret_bearer")
  })

  it("connections says what is connected and shows no part of any secret", async () => {
    const s = setup([{ name: "show", input: { view: "connections", arg: "" } }, "Connected."])
    await s.d.start()
    await s.say(`my strike key is ${API_KEY}`)
    await s.say("is my wallet connected?")
    const shown = s.model.seen.at(-1) ?? ""
    expect(shown).toContain("Wallet: not connected")
    expect(shown).toContain("Strike key (buying bitcoin): stored")
    expect(shown).not.toContain(API_KEY.slice(0, 4))
  })
})
