/**
 * The executor: the one path from an Action to a rail. It enforces, in order:
 * idempotent replay → policy → ledger "requested" → (confirmation) → rail call → ledger outcome.
 *
 * Nothing else in the codebase may call a rail's spending method. The LLM layer and the scheduler
 * both call `execute`.
 */
import { type Action, actionHash, isSpend } from "./action"
import { parseAddress } from "./address"
import type { CampaignReader, ContributionSink } from "./campaign"
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
import { givingRows } from "./recipient"
import type { RecipientReader } from "./recipient"

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
  /**
   * Seals bearer data (gift-card codes) before it is written to the ledger. Without it nothing is
   * stored: the code is returned once to the caller and never persisted.
   */
  seal?: (plain: string) => string
  /** How to wait for merchant delivery after paying (payment is not delivery, ADR-0011). */
  delivery?: { pollMs: number; maxPolls: number; sleep?: (ms: number) => Promise<void> }
  /** M5: the scheduler's persistence hook. Required for schedule_* actions. */
  schedules?: {
    create(
      a: Extract<Action, { kind: "schedule_buy" | "schedule_sweep" | "schedule_give" }>,
    ): Promise<string>
    cancel(id: string): Promise<void>
    /** M11: the user's own schedules, summarized for the model. */
    list?(): Promise<ScheduleSummary[]>
  }
  /** M11: campaigns, for find_recipient results. */
  campaigns?: CampaignReader
  /** M11: where successful gifts to a campaign are recorded (deduped by payment hash). */
  contributions?: ContributionSink
  /** Opaque per-user key for supporter counts; never the user id. */
  supporterKey?: string
  /** M9: the user-scoped recipient directory, for `find_recipient`. */
  recipients?: RecipientReader
}

export interface ScheduleSummary {
  id: string
  kind: string
  cron: string
  /** One human line: "Buy $25 on strike", "Give 1,000 sats to grace-fellowship (tithe)". */
  summary: string
  active: boolean
  lastRunAt: string | null
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
    const { result, preimage, detail, sealed } = await dispatch(action, rails, input)
    await ledger.append({
      type: "succeeded",
      id,
      at: now().toISOString(),
      preimage,
      detail,
      sealed,
    })
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
  input: ExecuteInput,
): Promise<{ result: unknown; preimage?: string; detail?: string; sealed?: string }> {
  const schedules = input.schedules
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
    case "give": {
      const w = need(rails.wallet, "wallet")
      const memo = action.note ? `${action.purpose}: ${action.note}` : action.purpose
      const { bolt11 } = await w.resolveAddress(action.address, action.amountSats, memo)
      const p = await w.payInvoice({
        bolt11,
        amountSats: action.amountSats,
        idempotencyKey: action.idempotencyKey,
      })
      if (action.campaignSlug && input.contributions) {
        try {
          await input.contributions.record({
            campaignSlug: action.campaignSlug,
            paymentHash: p.paymentHash,
            amountMsats: action.amountSats * 1000n,
            at: (input.now ?? (() => new Date()))().toISOString(),
            source: "chat",
            supporterKey: input.supporterKey,
            supporterName: action.supporterName,
          })
        } catch {
          /* the payment succeeded; the campaign tally is best-effort and recomputable from ledgers */
        }
      }
      return {
        result: { ...p, recipientSlug: action.recipientSlug, campaignSlug: action.campaignSlug },
        preimage: p.preimage,
        detail: `${action.recipientSlug}${action.campaignSlug ? ` (${action.campaignSlug})` : ""} · fee ${p.feeSats} sats`,
      }
    }
    case "list_schedules": {
      const s = need(schedules, "schedules")
      const list = s.list ? await s.list() : []
      return { result: { schedules: list }, detail: `${list.length} schedules` }
    }
    case "giving_summary": {
      const rows = givingRows(foldEntries(await input.ledger.events()), action.year)
      const byRecipient = new Map<
        string,
        { recipientSlug: string; recipientName: string; sats: bigint; gifts: number }
      >()
      for (const r of rows) {
        const e = byRecipient.get(r.recipientSlug) ?? {
          recipientSlug: r.recipientSlug,
          recipientName: r.recipientName,
          sats: 0n,
          gifts: 0,
        }
        e.sats += r.sats
        e.gifts++
        byRecipient.set(r.recipientSlug, e)
      }
      const totalSats = rows.reduce((a, r) => a + r.sats, 0n)
      return {
        result: {
          year: action.year,
          totalSats,
          gifts: rows.length,
          byRecipient: [...byRecipient.values()],
        },
        detail: `${rows.length} gifts, ${totalSats} sats`,
      }
    }
    case "schedule_give": {
      const s = need(schedules, "schedules")
      const scheduleId = await s.create(action)
      return { result: { scheduleId }, detail: scheduleId }
    }
    case "find_recipient": {
      const r = need(input.recipients, "recipients")
      const found = await r.search(action.query)
      const recipients = []
      for (const x of found) {
        const campaigns = input.campaigns
          ? (await input.campaigns.listForRecipient(x.slug))
              .filter((c) => c.active)
              .map((c) => ({
                slug: c.slug,
                title: c.title,
                story: c.story,
                goal:
                  "satsTotal" in c.goal
                    ? `${c.goal.satsTotal} sats total`
                    : `$${(c.goal.usdCentsPerMonth / 100n).toString()} per month`, // money-ok: label
              }))
          : []
        recipients.push({
          slug: x.slug,
          kind: x.kind,
          name: x.name,
          lightningAddress: x.lightningAddress,
          verified: x.verified !== null,
          website: x.website,
          country: x.country,
          description: x.description,
          private: !!x.ownerUserId,
          campaigns,
        })
      }
      return { result: { recipients }, detail: `${recipients.length} results` }
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
      const order = await g.createOrder({
        productId: action.productId,
        usdCents: action.usdCents,
        shippingSealed: action.shippingSealed,
        contactSealed: action.contactSealed,
      })
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
      await g.markPaid?.(order.orderId, p.preimage)
      // Payment is not delivery (ADR-0011): poll the merchant until delivered (bounded). Shipped goods
      // are complete at `paid`; the merchant fulfils later and the order page tracks it (M12).
      const d = input.delivery ?? { pollMs: 2000, maxPolls: 30 }
      const sleep = d.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
      const done = (o: Order) =>
        o.state === "delivered" ||
        o.state === "failed" ||
        (o.fulfilment === "shipped" && o.state === "paid")
      let after: Order = await g.getOrder(order.orderId)
      for (let i = 0; i < d.maxPolls && !done(after); i++) {
        await sleep(d.pollMs)
        after = await g.getOrder(order.orderId)
      }
      const redemption = after.state === "delivered" ? after.redemption : undefined
      return {
        result: { order: after, payment: p },
        preimage: p.preimage,
        detail: `${after.orderId} ${after.state}`,
        sealed: redemption && input.seal ? input.seal(redemption) : undefined,
      }
    }
    case "sweep_to_cold": {
      const oc = need(rails.onchain, "onchain")
      try {
        await parseAddress(action.address)
      } catch (err) {
        throw new RailError(
          oc.kind,
          "REJECTED",
          `not a valid bitcoin address: ${(err as Error).message}`,
        )
      }
      const bal = await oc.getBalance()
      const excess = bal.confirmedSats - action.keepSats
      const amount = excess < action.maxSats ? excess : action.maxSats
      const DUST = 10_000n
      if (amount < DUST) {
        return {
          result: { skipped: true, confirmedSats: bal.confirmedSats, amount },
          detail: `nothing to sweep (${amount} sats above the keep amount)`,
        }
      }
      const tx = await oc.send({
        address: action.address,
        amountSats: amount,
        satPerVbyte: action.satPerVbyte,
        idempotencyKey: action.idempotencyKey,
      })
      return {
        result: { ...tx, amountSats: amount },
        detail: `swept ${amount} sats, fee ${tx.feeSats}, tx ${tx.txid.slice(0, 12)}…`,
      }
    }
    case "schedule_sweep": {
      const s = need(schedules, "schedules")
      await parseAddress(action.address)
      const scheduleId = await s.create(action)
      return { result: { scheduleId }, detail: scheduleId }
    }
    case "search_products": {
      const g = need(rails.goods, "goods")
      const products = await g.searchProducts(action.query)
      return { result: { products }, detail: `${products.length} results` }
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
