/**
 * The executor: the one path from an Action to a rail. It enforces, in order:
 * idempotent replay → policy → ledger "requested" → (confirmation) → rail call → ledger outcome.
 *
 * Nothing else in the codebase may call a rail's spending method. The LLM layer and the scheduler
 * both call `execute`.
 */
import { type Action, actionHash, isSpend } from "./action"
import {
  type LedgerEntry,
  type LedgerStore,
  findByIdempotencyKey,
  foldEntries,
  spentSince,
} from "./ledger"
import type { Cents } from "./money"
import { type Decision, type EvaluateContext, type Policy, evaluate, windowStart } from "./policy"
import { type Order, RailError, type Rails } from "./rails"

export interface Confirmation {
  /** Hash of the exact action the human saw; must equal `actionHash(action)`. */
  actionHash: string
  confirmedBy: string
  at: string
}

export interface ExecuteInput {
  action: Action
  policy: Policy
  ledger: LedgerStore
  rails: Rails
  now?: () => Date
  /** Stable id generator; defaults to a counter + time. */
  newId?: () => string
  confirmation?: Confirmation
  context?: EvaluateContext
  /** M5: the scheduler's persistence hook. Required for schedule_* actions. */
  schedules?: {
    create(a: Extract<Action, { kind: "schedule_buy" }>): Promise<string>
    cancel(id: string): Promise<void>
  }
}

export type ExecuteResult =
  | { status: "succeeded"; id: string; decision: Decision; result: unknown; replayed?: boolean }
  | {
      status: "awaiting_confirmation"
      id: string
      decision: Extract<Decision, { type: "needs_confirmation" }>
    }
  | { status: "denied"; id: string; decision: Extract<Decision, { type: "deny" }> }
  | { status: "failed"; id: string; decision: Decision; error: string; code?: string }

let counter = 0
const defaultNewId = () => `act_${Date.now().toString(36)}_${(++counter).toString(36)}`

export async function execute(input: ExecuteInput): Promise<ExecuteResult> {
  const now = input.now ?? (() => new Date())
  const newId = input.newId ?? defaultNewId
  const { action, policy, ledger, rails } = input

  const entries = foldEntries(await ledger.events())

  // 1. Idempotent replay: a key that already succeeded or is in flight is never executed again.
  if (isSpend(action)) {
    const prior = findByIdempotencyKey(entries, action.idempotencyKey)
    if (prior && (prior.outcome === "succeeded" || prior.outcome === "pending")) {
      return {
        status: "succeeded",
        id: prior.id,
        decision: prior.decision,
        result: priorResult(prior),
        replayed: true,
      }
    }
  }

  // 2. Policy, against the rolling window.
  const decision = evaluate(
    action,
    policy,
    { spentSats: spentSince(entries, windowStart(now())) },
    input.context,
  )
  const id = newId()
  const at = now().toISOString()

  if (decision.type === "deny") {
    await ledger.append({ type: "requested", id, at, action, decision })
    return { status: "denied", id, decision }
  }

  if (decision.type === "needs_confirmation") {
    const ok =
      input.confirmation &&
      input.confirmation.actionHash === decision.actionHash &&
      input.confirmation.actionHash === actionHash(action)
    if (!ok) {
      await ledger.append({ type: "requested", id, at, action, decision })
      return { status: "awaiting_confirmation", id, decision }
    }
  }

  // 3. Record the attempt BEFORE touching the rail, so a crash mid-payment is visible as pending.
  await ledger.append({ type: "requested", id, at, action, decision })
  await ledger.append({ type: "started", id, at })

  // 4. The rail.
  try {
    const { result, preimage, detail } = await dispatch(action, rails, input.schedules)
    await ledger.append({ type: "succeeded", id, at: now().toISOString(), preimage, detail })
    return { status: "succeeded", id, decision, result }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const code = err instanceof RailError ? err.code : undefined
    // UNKNOWN_STATE: money may have moved. Leave the entry pending so the budget stays reserved and
    // an operator (or a later reconciliation) resolves it; a retry with the same key is replayed, not re-paid.
    if (code !== "UNKNOWN_STATE") {
      await ledger.append({ type: "failed", id, at: now().toISOString(), error: message })
    }
    return { status: "failed", id, decision, error: message, code }
  }
}

function priorResult(e: LedgerEntry): unknown {
  return { preimage: e.preimage, detail: e.detail }
}

function need<T>(rail: T | undefined, name: string): T {
  if (!rail) throw new RailError(name, "BAD_CONFIG", `${name} rail is not configured`)
  return rail
}

async function dispatch(
  action: Action,
  rails: Rails,
  schedules: ExecuteInput["schedules"],
): Promise<{ result: unknown; preimage?: string; detail?: string }> {
  switch (action.kind) {
    case "get_balance": {
      const r = await need(rails.wallet, "wallet").getBalance()
      return { result: r, detail: `${r.sats} sats` }
    }
    case "make_invoice": {
      const inv = await need(rails.wallet, "wallet").makeInvoice(action)
      return { result: inv, detail: inv.paymentHash }
    }
    case "pay_invoice": {
      const p = await need(rails.wallet, "wallet").payInvoice(action)
      return { result: p, preimage: p.preimage, detail: `fee ${p.feeSats} sats` }
    }
    case "pay_address": {
      const w = need(rails.wallet, "wallet")
      const { bolt11 } = await w.resolveAddress(action.address, action.amountSats, action.memo)
      const p = await w.payInvoice({
        bolt11,
        amountSats: action.amountSats,
        idempotencyKey: action.idempotencyKey,
      })
      return { result: p, preimage: p.preimage, detail: `fee ${p.feeSats} sats` }
    }
    case "buy_bitcoin": {
      const x = need(rails.exchange, "exchange")
      // Quote → execute in one tight call: quotes live seconds and no LLM sits in between.
      const q = await x.createQuote({ usdCents: action.usdCents })
      const ex = await x.executeQuote(q.id)
      return { result: ex, detail: `${ex.sats} sats for ${fmt(ex.usdCents)}` }
    }
    case "schedule_buy": {
      const s = need(schedules, "schedules")
      const scheduleId = await s.create(action)
      return { result: { scheduleId }, detail: scheduleId }
    }
    case "cancel_schedule": {
      await need(schedules, "schedules").cancel(action.scheduleId)
      return { result: { cancelled: action.scheduleId }, detail: action.scheduleId }
    }
    case "buy_product": {
      const g = need(rails.goods, "goods")
      const w = need(rails.wallet, "wallet")
      const order = await g.createOrder({ productId: action.productId, usdCents: action.usdCents })
      if (order.amountSats > action.amountSats) {
        throw new RailError(
          g.kind,
          "AMOUNT_OUT_OF_RANGE",
          `merchant asks ${order.amountSats} sats, approved ${action.amountSats}`,
        )
      }
      const p = await w.payInvoice({
        bolt11: order.bolt11,
        amountSats: order.amountSats,
        idempotencyKey: action.idempotencyKey,
      })
      // Payment is not delivery (ADR-0011): report the order, caller polls `getOrder`.
      const after: Order = await g.getOrder(order.orderId)
      return {
        result: { order: after, payment: p },
        preimage: p.preimage,
        detail: `${after.orderId} ${after.state}`,
      }
    }
    case "pay_l402": {
      const c = need(rails.compute, "compute")
      const w = need(rails.wallet, "wallet")
      const init = { method: action.method ?? "GET", headers: action.headers, body: action.body }
      const first = await c.request(action.url, init)
      if (first.status !== 402)
        return { result: first, detail: `no payment needed (${first.status})` }
      if (!("challenge" in first))
        throw new RailError(c.kind, "BAD_RESPONSE", "402 without challenge")
      if (first.challenge.amountSats > action.amountSats) {
        throw new RailError(
          c.kind,
          "AMOUNT_OUT_OF_RANGE",
          `asks ${first.challenge.amountSats} sats, approved ${action.amountSats}`,
        )
      }
      const p = await w.payInvoice({
        bolt11: first.challenge.invoice,
        amountSats: first.challenge.amountSats,
        idempotencyKey: action.idempotencyKey,
      })
      const res = await c.requestWithToken(
        action.url,
        { macaroon: first.challenge.macaroon, preimage: p.preimage },
        init,
      )
      return {
        result: res,
        preimage: p.preimage,
        detail: `paid ${first.challenge.amountSats} sats, HTTP ${res.status}`,
      }
    }
  }
}

function fmt(c: Cents): string {
  return `$${(c / 100n).toString()}.${(c % 100n).toString().padStart(2, "0")}` // money-ok
}
