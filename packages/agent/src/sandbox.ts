/**
 * The sandbox: a complete, stateless demo world. Fake rails with fake sats, the real policy engine,
 * executor, ledger and agent loop. State round-trips as JSON (bigints as "123n") so a serverless
 * route can rebuild it per request and a browser can hold it.
 */
import {
  type Action,
  type ComputeRail,
  DEFAULT_POLICY,
  FakeExchangeRail,
  FakeGoodsRail,
  FakeOnChainRail,
  FakeWalletRail,
  InMemoryLedgerStore,
  type LedgerEntry,
  type LedgerEvent,
  type Policy,
  type PriceSnapshot,
  foldEntries,
  parseAction,
  serializeAction,
} from "@agentic-bitcoin/core"
import { InMemoryPendingStore, type PendingStore, type UserContext, runTurn } from "./agent"
import type { LlmClient, LlmMessage } from "./llm"

export const SANDBOX_COLD_ADDRESS = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
export const SANDBOX_PRICE: PriceSnapshot = {
  usdCentsPerBtc: 8_316_900n,
  asOf: "2026-10-08T00:00:00.000Z",
  source: "sandbox",
}

export interface SandboxState {
  version: 1
  walletSats: string
  onchainSats: string
  policy: Policy
  events: LedgerEvent[]
  pending: { actionHash: string; action: Action }[]
  history: LlmMessage[]
  /** Stable counter for schedule ids and the like. */
  seq: number
}

export const SANDBOX_POLICY: Policy = {
  ...DEFAULT_POLICY,
  dailyCapSats: 100_000n,
  perActionCapSats: 50_000n,
  confirmAboveSats: 5_000n,
  coldStorageAddresses: [SANDBOX_COLD_ADDRESS],
  rails: { wallet: true, exchange: true, goods: true, compute: true, onchain: true },
}

export function initialSandbox(): SandboxState {
  return {
    version: 1,
    walletSats: "250000",
    onchainSats: "1200000",
    policy: SANDBOX_POLICY,
    events: [],
    pending: [],
    history: [],
    seq: 0,
  }
}

// --- bigint-safe JSON ---------------------------------------------------------------------------
export const encode = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `${x}n` : x))
export const decode = <T>(s: string): T =>
  JSON.parse(s, (_k, x) =>
    typeof x === "string" && /^\d+n$/.test(x) ? BigInt(x.slice(0, -1)) : x,
  ) as T

/** A compute rail that always charges 21 sats per request and answers with a canned body. */
class SandboxComputeRail implements ComputeRail {
  readonly kind = "sandbox-compute"
  async request(url: string) {
    return {
      status: 402 as const,
      challenge: {
        macaroon: "sandbox-macaroon",
        invoice: `lnbc210n1sandbox${url.length}`,
        amountSats: 21n,
      },
    }
  }
  async requestWithToken(url: string) {
    return {
      status: 200,
      body: JSON.stringify({
        ok: true,
        url,
        answer: "A satoshi is one hundred-millionth of a bitcoin.",
      }),
      headers: { "content-type": "application/json" },
    }
  }
}

class StatePending implements PendingStore {
  constructor(private readonly rows: SandboxState["pending"]) {}
  async set(_u: string, actionHash: string, action: Action) {
    this.rows.push({ actionHash, action })
  }
  async get(_u: string, h: string) {
    return this.rows.find((r) => r.actionHash === h)?.action ?? null
  }
  async delete(_u: string, h: string) {
    const i = this.rows.findIndex((r) => r.actionHash === h)
    if (i >= 0) this.rows.splice(i, 1)
  }
  async latest() {
    const last = this.rows.at(-1)
    return last ? { actionHash: last.actionHash, action: last.action } : null
  }
}

export interface SandboxTurn {
  reply: string
  deliveries: string[]
  pending?: { actionHash: string; summary: string }
  state: SandboxState
  ledger: LedgerEntry[]
  toolCalls: { name: string; status: string }[]
}

/** Run one user message (or a yes/no) against the sandbox and return the new state. */
export async function sandboxTurn(
  llm: LlmClient,
  input: SandboxState,
  text: string,
  now: () => Date = () => new Date(),
): Promise<SandboxTurn> {
  const state: SandboxState = decode<SandboxState>(encode(input)) // defensive copy
  const wallet = new FakeWalletRail({ balanceSats: BigInt(state.walletSats), now })
  const onchain = new FakeOnChainRail({ confirmedSats: BigInt(state.onchainSats) })
  const goods = new FakeGoodsRail()
  goods.autoProgress = true
  const ledger = new InMemoryLedgerStore()
  for (const ev of state.events) await ledger.append(ev)
  const pending = new StatePending(state.pending)
  let seq = state.seq
  const schedules = {
    async create() {
      seq++
      return `sch_${seq}`
    },
    async cancel() {},
  }
  const ctx: UserContext = {
    userId: "demo",
    policy: state.policy,
    ledger,
    rails: {
      wallet,
      onchain,
      goods,
      exchange: new FakeExchangeRail({ now, balanceCents: 500_00n }),
      compute: new SandboxComputeRail(),
    },
    pending,
    schedules,
    delivery: { pollMs: 25, maxPolls: 8 },
  }
  const deps = {
    llm,
    resolveContext: async () => ctx,
    price: async () => SANDBOX_PRICE,
    now,
    maxIterations: 4,
  }

  let result: Awaited<ReturnType<typeof runTurn>>
  const t = text.trim()
  const yes = /^(y|yes|yep|confirm|approve|ok)[.!]?$/i.test(t)
  const no = /^(n|no|nope|cancel|deny)[.!]?$/i.test(t)
  if ((yes || no) && (await pending.latest())) {
    const latest = (await pending.latest()) as { actionHash: string; action: Action }
    const { confirmPending } = await import("./agent")
    if (no) {
      await pending.delete("demo", latest.actionHash)
      result = {
        reply: "Cancelled. Nothing was sent.",
        history: state.history,
        toolCalls: [],
        deliveries: [],
      }
    } else {
      const out = await confirmPending(ctx, latest.actionHash, {
        confirmedBy: "demo",
        price: SANDBOX_PRICE,
        now,
      })
      const parsed = JSON.parse(out.content) as {
        status: string
        summary?: string
        error?: string
        result?: Record<string, unknown>
      }
      const { replyFor } = await import("./scripted")
      const reply =
        parsed.status === "succeeded"
          ? replyFor(
              latest.action.kind === "pay_address" ? "pay_lightning_address" : latest.action.kind,
              parsed as Record<string, unknown>,
            )
          : parsed.status === "no_pending_action"
            ? "That approval was already used."
            : `Not done: ${parsed.error ?? parsed.status}.`
      result = {
        reply,
        history: state.history,
        toolCalls: [{ name: "confirm_action", status: parsed.status }],
        deliveries: out.deliverToUser ? [out.deliverToUser] : [],
      }
    }
  } else {
    result = await runTurn(deps, "demo", t, state.history)
  }

  const events = await ledger.events()
  const next: SandboxState = {
    version: 1,
    walletSats: (await wallet.getBalance()).sats.toString(),
    onchainSats: (await onchain.getBalance()).confirmedSats.toString(),
    policy: state.policy,
    events: [...events],
    pending: state.pending,
    history: result.history.slice(-24),
    seq,
  }
  return {
    reply: result.reply,
    deliveries: result.deliveries,
    pending: result.pending,
    state: next,
    ledger: foldEntries(events),
    toolCalls: result.toolCalls,
  }
}

/** Serialise for the wire. */
export function packState(s: SandboxState): string {
  return encode({
    ...s,
    events: s.events.map((e) =>
      e.type === "requested" ? { ...e, action: serializeAction(e.action) } : e,
    ),
    pending: s.pending.map((p) => ({ ...p, action: serializeAction(p.action) })),
  })
}
export function unpackState(text: string): SandboxState {
  const raw = decode<SandboxState>(text)
  return {
    ...raw,
    events: raw.events.map((e) =>
      e.type === "requested" && typeof e.action === "string"
        ? { ...e, action: parseAction(e.action) }
        : e,
    ),
    pending: raw.pending.map((p) => ({
      ...p,
      action: typeof p.action === "string" ? parseAction(p.action as unknown as string) : p.action,
    })),
  }
}
