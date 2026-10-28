import { InMemoryPendingStore, ScriptedLlmClient, type UserContext } from "@agentic-bitcoin/agent"
import {
  FakeWalletRail,
  InMemoryLedgerStore,
  InMemoryReferralStore,
  InMemoryRewardStore,
  type Policy,
  type ReferralRules,
  qualifyReferral,
  readEntries,
} from "@agentic-bitcoin/core"
import { POLICIES, PRICE, clockAt } from "@agentic-bitcoin/fixtures"
import { describe, expect, it } from "vitest"
import { Dispatcher } from "./dispatcher"
import { InMemoryHistoryStore, InMemoryPolicyStore, InMemorySecretStore } from "./store/stores"
import { FakeSurface } from "./surfaces/surface"

const RULES: ReferralRules = {
  referrerSats: 2_000n,
  friendSats: 500n,
  qualifyingSats: 1_000n,
  maxPerReferrerPerMonth: 10,
}

function setup(opts: { rules?: ReferralRules | null; inviteCode?: string } = {}) {
  const surface = new FakeSurface()
  const policies = new InMemoryPolicyStore()
  const policy: Policy = { ...POLICIES.open }
  const ledgers = new Map<string, InMemoryLedgerStore>()
  const ledgerOf = (u: string) => {
    const have = ledgers.get(u)
    if (have) return have
    const made = new InMemoryLedgerStore()
    ledgers.set(u, made)
    return made
  }
  const pending = new InMemoryPendingStore()
  const referralStore = new InMemoryReferralStore()
  const rewardStore = new InMemoryRewardStore()
  const rules = opts.rules === undefined ? RULES : opts.rules
  let seq = 0
  const referrals = rules ? { store: referralStore, rules, newId: () => `rf_${++seq}` } : undefined
  const siteUrl = "https://anvard.ai"
  const resolveContext = async (userId: string): Promise<UserContext> => ({
    userId,
    policy,
    ledger: ledgerOf(userId),
    rails: { wallet: new FakeWalletRail({ balanceSats: 100_000n }) },
    pending,
    rewardStore,
    referrals: rules ? { store: referralStore, rules, siteUrl } : undefined,
  })
  const now = clockAt() // the same instant as the agent, so a payment is never "before" the join
  const afterSpend = async (userId: string) => {
    if (!rules) return
    await qualifyReferral(
      { referrals: referralStore, rewards: rewardStore, rules, newRewardId: () => `rw_${++seq}` },
      userId,
      await readEntries(ledgerOf(userId)),
    )
  }
  const d = new Dispatcher({
    surface,
    agent: { llm: new ScriptedLlmClient(), price: async () => PRICE, now: clockAt() },
    resolveContext,
    policies,
    history: new InMemoryHistoryStore(),
    secrets: new InMemorySecretStore(),
    secretsKey: null,
    probeWallet: async () => ({}),
    rewardStore,
    referrals,
    afterSpend,
    siteUrl,
    inviteCode: opts.inviteCode,
    now,
  })
  const known = async (...users: string[]) => {
    for (const u of users) await policies.set(u, policy)
  }
  const last = () => surface.sent.at(-1)?.m.text ?? ""
  const say = async (userId: string, text: string) => {
    await surface.receive({ userId, text })
    return last()
  }
  const sentTo = (userId: string) =>
    surface.sent.filter((s) => s.userId === userId).map((s) => s.m.text)
  return { d, say, known, sentTo, referralStore, rewardStore }
}

const codeIn = (text: string) => /invite code is ([A-Z2-9]{6})/.exec(text)?.[1] ?? ""

describe("referral rewards in sats (M22, ADR-0025)", () => {
  it("a friend's code at first contact links the two and opens the door; /join works for a user who has not paid yet; the first qualifying payment records both rewards", async () => {
    const { d, say, known, sentTo, referralStore, rewardStore } = setup()
    await d.start()
    await known("alice", "carol", "dave")

    const refer = await say("alice", "/refer")
    const code = codeIn(refer)
    expect(code).toMatch(/^[A-Z2-9]{6}$/)
    expect(refer).toContain(`https://anvard.ai/join/${code}`)
    expect(refer).toContain("you get 2,000 sats and they get 500 sats")
    expect(refer).not.toContain("So far")

    // bob is new: his first message is the code (typed with a dash, lower case)
    const first = await say("bob", `${code.slice(0, 3).toLowerCase()}-${code.slice(3)}`)
    expect(first).toContain(
      "Your friend's code is in: after your first payment of at least 1,000 sats, you get 500 sats and your friend gets 2,000 sats",
    )
    expect(first).toContain("per day") // the limits wizard follows
    expect((await referralStore.forFriend("bob"))?.referrerId).toBe("alice")

    // carol already onboarded, never paid: /join
    expect(await say("carol", "/join")).toMatch(/^Usage: \/join <code>/)
    expect(await say("carol", "/join ZZZZZZ")).toBe(
      "No invite with the code ZZZZZZ. Check it with your friend.",
    )
    expect(await say("carol", `/join ${code}`)).toMatch(/^You're in with/)
    expect(await say("carol", `/join ${code}`)).toContain("already joined")
    expect(await say("alice", `/join ${code}`)).toBe("That is your own invite code.")
    expect(await say("alice", "/refer")).toContain(
      "So far: 2 joined · 0 qualified · 0 sats earned.",
    )

    // a small payment does not qualify; the first of at least 1,000 sats does, once
    expect(await say("carol", "pay 200 sats to gm@getalby.com")).toContain("Paid.")
    expect((await rewardStore.listForUser("alice")).length).toBe(0)
    expect(await say("carol", "pay 1500 sats to gm@getalby.com")).toContain("Paid.")
    expect(
      (await rewardStore.listForUser("alice")).map((r) => [r.source, r.amountSats, r.state]),
    ).toEqual([["referral", 2_000n, "pending"]])
    expect((await rewardStore.listForUser("carol")).map((r) => r.amountSats)).toEqual([500n])
    expect(await say("carol", "pay 3000 sats to gm@getalby.com")).toContain("Paid.")
    expect((await rewardStore.listForUser("alice")).length).toBe(1)
    const ref = await referralStore.forFriend("carol")
    expect(ref?.qualifyingSats).toBe(1_500n)
    expect(ref?.rewardIds.length).toBe(2)

    expect(await say("alice", "/refer")).toContain(
      "So far: 2 joined · 1 qualified · 2,000 sats earned.",
    )
    expect(await say("carol", "/rewards")).toContain("500 sats payable now")
    expect(await say("alice", "/rewards")).toContain("2,000 sats payable now")

    // dave paid before joining: too late
    expect(await say("dave", "pay 1000 sats to gm@getalby.com")).toContain("Paid.")
    expect(await say("dave", `/join ${code}`)).toContain("counts only before your first payment")
    expect(sentTo("bob").length).toBe(1)
  })

  it("the model answers 'how do I invite a friend' with the code and the terms", async () => {
    const { d, say, known } = setup()
    await d.start()
    await known("alice")
    const code = codeIn(await say("alice", "/refer"))
    const reply = await say("alice", "how do I invite a friend?")
    expect(reply).toContain(`Your invite code is ${code} (https://anvard.ai/join/${code})`)
    expect(reply).toContain("you get 2,000 sats and they get 500 sats")
  })

  it("a friend's code satisfies the operator's invite gate", async () => {
    const { d, say, known, referralStore } = setup({ inviteCode: "SATS-2026" })
    await d.start()
    await known("alice")
    const code = codeIn(await say("alice", "/refer"))
    expect(await say("eve", "hello")).toContain("invite code")
    expect(await say("eve", "hello")).not.toContain("per day")
    expect(await say("eve", code)).toContain("Your friend's code is in")
    expect((await referralStore.forFriend("eve"))?.referrerId).toBe("alice")
  })

  it("is off until the operator funds a side", async () => {
    const off = setup({ rules: { ...RULES, referrerSats: 0n, friendSats: 0n } })
    await off.d.start()
    await off.known("alice", "bob")
    expect(await off.say("alice", "/refer")).toBe("Referral rewards are not on for this server.")
    expect(await off.say("bob", "/join ABCDEF")).toBe(
      "Referral rewards are not on for this server.",
    )
    expect(await off.say("alice", "what is my referral code")).toBe(
      "Referral rewards are not on for this server.",
    )
    expect(await off.say("alice", "/rewards")).not.toContain("/refer")
    const none = setup({ rules: null })
    await none.d.start()
    await none.known("alice")
    expect(await none.say("alice", "/refer")).toBe("Referral rewards are not on for this server.")
    expect(await none.say("alice", "/help")).toContain("/refer")
  })
})
