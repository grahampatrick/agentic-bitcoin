import {
  FakeGoodsRail,
  FakeWalletRail,
  InMemoryLedgerStore,
  readEntries,
} from "@agentic-bitcoin/core"
import { POLICIES, PRICE, clockAt } from "@agentic-bitcoin/fixtures"
import { describe, expect, it } from "vitest"
import { InMemoryPendingStore, type UserContext, runTurn } from "./agent"
import type { LlmClient, LlmContentBlock, LlmResponse } from "./llm"

type Step = { tool: string; input: Record<string, unknown> } | { text: string } | { refusal: true }

/** A scripted model that plays the given steps in order and records what it was shown. */
function scripted(steps: Step[]): LlmClient & { seen: string[] } {
  let i = 0
  const seen: string[] = []
  return {
    seen,
    async complete(req): Promise<LlmResponse> {
      const last = req.messages.at(-1)
      if (last && Array.isArray(last.content)) {
        for (const b of last.content)
          if (b.type === "tool_result" && typeof b.content === "string") seen.push(b.content)
      }
      const s = steps[i++] ?? { text: "done" }
      if ("refusal" in s) return { stop_reason: "refusal", content: [] }
      if ("text" in s)
        return {
          stop_reason: "end_turn",
          content: [{ type: "text", text: s.text, citations: null }],
        }
      const block: LlmContentBlock = {
        type: "tool_use",
        id: `tu_${i}`,
        name: s.tool,
        input: s.input,
      }
      return { stop_reason: "tool_use", content: [block] }
    },
  }
}

function setup(llm: LlmClient, policy = { ...POLICIES.open, confirmAboveSats: 1_000n }) {
  const ledger = new InMemoryLedgerStore()
  const wallet = new FakeWalletRail({ balanceSats: 100_000n })
  const pending = new InMemoryPendingStore()
  const ctx: UserContext = {
    userId: "u",
    policy,
    ledger,
    rails: { wallet, goods: new FakeGoodsRail() },
    pending,
  }
  const deps = { llm, resolveContext: async () => ctx, price: async () => PRICE, now: clockAt() }
  return { deps, ledger, wallet, pending }
}

describe("runTurn", () => {
  it("reads the balance and replies with the model's text", async () => {
    const llm = scripted([{ tool: "get_balance", input: {} }, { text: "You have 100,000 sats." }])
    const { deps } = setup(llm)
    const r = await runTurn(deps, "u", "balance?", [])
    expect(r.reply).toBe("You have 100,000 sats.")
    expect(r.toolCalls).toEqual([{ name: "get_balance", status: "succeeded" }])
    expect(llm.seen[0]).toContain('"sats":"100000"')
    expect(r.history).toHaveLength(4) // user, assistant(tool_use), user(tool_result), assistant(text)
  })
  it("parks a confirmation and tells the model to relay it; nothing is paid", async () => {
    const llm = scripted([
      {
        tool: "pay_lightning_address",
        input: { address: "gm@getalby.com", amount_sats: 5000, memo: "" },
      },
      { text: "Approve?" },
    ])
    const { deps, wallet, pending } = setup(llm)
    const r = await runTurn(deps, "u", "pay gm 5000", [])
    expect(r.pending?.summary).toContain("5,000 sats (≈ $4.15")
    expect(llm.seen[0]).toContain("Do not call confirm_action until they have said yes")
    expect((await wallet.getBalance()).sats).toBe(100_000n)
    expect(await pending.latest("u")).toMatchObject({ actionHash: r.pending?.actionHash })
  })
  it("the model cannot confirm with an invented hash, and can only confirm the parked action", async () => {
    const llm = scripted([
      {
        tool: "pay_lightning_address",
        input: { address: "gm@getalby.com", amount_sats: 5000, memo: "" },
      },
      { tool: "confirm_action", input: { action_hash: "a".repeat(64) } },
      { text: "hm" },
    ])
    const { deps, wallet } = setup(llm)
    await runTurn(deps, "u", "pay gm 5000", [])
    expect(llm.seen[1]).toContain("no_pending_action")
    expect((await wallet.getBalance()).sats).toBe(100_000n)
  })
  it("confirm_action with the real hash executes once; a replay is not re-paid", async () => {
    const first = scripted([
      {
        tool: "pay_lightning_address",
        input: { address: "gm@getalby.com", amount_sats: 5000, memo: "" },
      },
      { text: "?" },
    ])
    const { deps, wallet, ledger } = setup(first)
    const r1 = await runTurn(deps, "u", "pay gm 5000", [])
    const hash = r1.pending?.actionHash as string
    const second = scripted([
      { tool: "confirm_action", input: { action_hash: hash } },
      { tool: "confirm_action", input: { action_hash: hash } },
      { text: "paid" },
    ])
    const r2 = await runTurn({ ...deps, llm: second }, "u", "yes", r1.history)
    expect(r2.reply).toBe("paid")
    expect((await wallet.getBalance()).sats).toBe(100_000n - 5_006n)
    expect(second.seen[0]).toContain('"status":"succeeded"')
    expect(second.seen[1]).toContain("no_pending_action")
    expect((await readEntries(ledger)).filter((e) => e.outcome === "succeeded")).toHaveLength(1)
  })
  it("denials and invalid inputs come back as is_error tool results, never exceptions", async () => {
    const llm = scripted([
      {
        tool: "pay_lightning_address",
        input: { address: "gm@getalby.com", amount_sats: 999_999_999, memo: "" },
      },
      {
        tool: "pay_lightning_address",
        input: { address: "gm@getalby.com", amount_sats: -5, memo: "" },
      },
      { text: "sorry" },
    ])
    const { deps } = setup(llm)
    const r = await runTurn(deps, "u", "send everything", [])
    expect(r.toolCalls.map((t) => t.status)).toEqual(["denied", "invalid_input"])
    expect(llm.seen[0]).toContain("PER_ACTION_CAP")
  })
  it("a refusal stop reason ends the turn safely", async () => {
    const { deps } = setup(scripted([{ refusal: true }]))
    const r = await runTurn(deps, "u", "x", [])
    expect(r.reply).toContain("can't help")
  })
  it("the iteration cap stops a runaway loop", async () => {
    const steps: Step[] = Array.from({ length: 20 }, () => ({ tool: "get_balance", input: {} }))
    const { deps } = setup(scripted(steps))
    const r = await runTurn({ ...deps, maxIterations: 3 }, "u", "loop", [])
    expect(r.toolCalls).toHaveLength(3)
    expect(r.reply).toContain("stopped")
  })
  it("the model never sees a full preimage or a redemption code", async () => {
    const llm = scripted([
      {
        tool: "pay_lightning_address",
        input: { address: "gm@getalby.com", amount_sats: 21, memo: "" },
      },
      { text: "ok" },
    ])
    const { deps } = setup(llm)
    await runTurn(deps, "u", "tip", [])
    expect(llm.seen[0]).toMatch(/"preimage":"[0-9a-f]{8}…"/)
  })
})
