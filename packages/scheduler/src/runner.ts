/**
 * The runner: once a minute (worker loop or a cron-triggered HTTP route), find schedules whose
 * cron matches the current UTC minute and have not fired for it, and execute each as a
 * `buy_bitcoin` Action with `requestedBy: "schedule"` through core `execute`. Denials and
 * failures land in the ledger like any other action; the schedule is marked as run for the slot
 * either way so a failing buy does not retry every minute (the next slot will try again).
 */
import {
  type Action,
  type ExecuteResult,
  type LedgerStore,
  type Policy,
  type PriceSnapshot,
  type Rails,
  type RecipientReader,
  type Sats,
  type WalletRail,
  actionHash,
  centsToSats,
  execute,
  isTrustedRecipient,
  satsToCents,
} from "@agentic-bitcoin/core"
import { matches, parseCron } from "./cron"
import type { Schedule, ScheduleStore } from "./schedule"

export interface RunnerDeps {
  schedules: ScheduleStore
  /** Per-user: policy, ledger and rails. The exchange rail must be present for a run to succeed. */
  resolve(userId: string): Promise<{ policy: Policy; ledger: LedgerStore; rails: Rails }>
  price(): Promise<PriceSnapshot | undefined>
  /** Sweep: an exchange that can pay a Lightning invoice. Optional. */
  sweep?: (userId: string, rails: Rails, sats: Sats) => Promise<string | null>
  /** M9: the user-scoped recipient directory, so a recurring gift re-resolves its recipient at fire time. */
  recipients?: (userId: string) => RecipientReader
  now?: () => Date
  log?: (line: string) => void
}

export interface RunReport {
  slot: string
  fired: { scheduleId: string; userId: string; status: ExecuteResult["status"]; detail?: string }[]
}

/** Truncate to the minute, UTC, ISO. One slot = one possible firing per schedule. */
export function slotOf(d: Date): string {
  const t = new Date(d)
  t.setUTCSeconds(0, 0)
  return t.toISOString()
}

export async function runDue(deps: RunnerDeps): Promise<RunReport> {
  const now = deps.now ?? (() => new Date())
  const at = now()
  const slot = slotOf(at)
  const log = deps.log ?? (() => {})
  const report: RunReport = { slot, fired: [] }

  for (const s of await deps.schedules.listActive()) {
    let due: boolean
    try {
      due = matches(parseCron(s.cron), at)
    } catch (err) {
      log(`schedule ${s.id}: bad cron (${(err as Error).message}); cancelling`)
      await deps.schedules.cancel(s.id)
      continue
    }
    if (!due || s.lastRunAt === slot) continue
    // Claim the slot BEFORE executing so two runners (or a crash + restart) never double-buy.
    await deps.schedules.markRun(s.id, slot)
    const result = await fire(s, deps, at)
    const detail = "paused" in result ? result.paused : detailOf(result)
    report.fired.push({ scheduleId: s.id, userId: s.userId, status: result.status, detail })
    log(`schedule ${s.id} (${s.userId}): ${result.status} ${detail ?? ""}`.trim())
  }
  return report
}

type Paused = { status: "failed"; paused: string }

async function fire(s: Schedule, deps: RunnerDeps, at: Date): Promise<ExecuteResult | Paused> {
  const { policy, ledger, rails } = await deps.resolve(s.userId)
  const price = await deps.price()
  const key = `${s.id}:${slotOf(at)}`
  let give: Extract<Action, { kind: "give" }> | null = null
  if (s.kind === "give") {
    // Re-resolve the recipient: a gift must never go to a stale or revoked address (ADR-0013).
    const reader = deps.recipients?.(s.userId)
    const r = reader ? await reader.get(s.recipientSlug ?? "") : null
    if (reader && !r) {
      await deps.schedules.cancel(s.id)
      return { status: "failed", paused: `recipient ${s.recipientSlug} is gone; schedule paused` }
    }
    const amount = s.usdCents > 0n && price ? centsToSats(s.usdCents, price) : s.estimatedSats
    give = {
      kind: "give",
      recipientSlug: s.recipientSlug ?? "",
      recipientName: r?.name ?? s.recipientName ?? s.recipientSlug ?? "",
      address: r?.lightningAddress ?? s.address ?? "",
      verified: r ? isTrustedRecipient(r, s.userId) : (s.verified ?? false),
      amountSats: amount,
      purpose: s.purpose ?? "gift",
      fiatCentsAtRequest: price ? satsToCents(amount, price) : undefined,
      idempotencyKey: key,
      requestedBy: "schedule",
    }
  }
  const action: Action = give
    ? give
    : s.kind === "sweep"
      ? {
          kind: "sweep_to_cold",
          address: s.address ?? "",
          keepSats: s.keepSats ?? 0n,
          maxSats: s.maxSats ?? 0n,
          idempotencyKey: key,
          requestedBy: "schedule",
        }
      : {
          kind: "buy_bitcoin",
          exchange: s.exchange,
          usdCents: s.usdCents,
          estimatedSats: price ? centsToSats(s.usdCents, price) : s.estimatedSats,
          idempotencyKey: key,
          requestedBy: "schedule",
        }
  // The user confirmed the schedule itself (schedule_* always needs a yes); each firing is pre-approved.
  const result = await execute({
    action,
    policy,
    ledger,
    rails,
    now: () => at,
    context: { price },
    confirmation: {
      actionHash: actionHash(action),
      confirmedBy: `schedule:${s.id}`,
      at: at.toISOString(),
    },
  })
  if (result.status === "succeeded" && s.sweepToWallet && deps.sweep) {
    const bought = (result.result as { sats?: Sats })?.sats ?? 0n
    if (bought > 0n) {
      try {
        const id = await deps.sweep(s.userId, rails, bought)
        if (id) (result as { sweep?: string }).sweep = id
      } catch (err) {
        ;(result as { sweepError?: string }).sweepError = (err as Error).message
      }
    }
  }
  return result
}

function detailOf(r: ExecuteResult): string | undefined {
  if (r.status === "succeeded") {
    const x = r.result as
      | { sats?: bigint; usdCents?: bigint; txid?: string; amountSats?: bigint; skipped?: boolean }
      | undefined
    if (x?.txid) return `swept ${x.amountSats} sats, tx ${x.txid.slice(0, 12)}…`
    const g = r.result as { recipientSlug?: string; amountSats?: bigint } | undefined
    if (g?.recipientSlug) return `gave ${g.amountSats} sats to ${g.recipientSlug}`
    if (x?.skipped) return "nothing to sweep"
    return x?.sats !== undefined ? `${x.sats} sats for ${x.usdCents} cents` : undefined
  }
  if (r.status === "failed") return `${r.code ?? ""} ${r.error}`.trim()
  if (r.status === "denied") return r.decision.reason
  return undefined
}

/**
 * The executor's `schedules` hook: turns `schedule_buy` / `cancel_schedule` Actions into store
 * calls. `sweepToWallet` defaults to false; the wallet-pairing flow (M7) turns it on per user.
 */
export function schedulesHook(store: ScheduleStore, opts: { sweepToWallet?: boolean } = {}) {
  return {
    async create(
      a: Extract<Action, { kind: "schedule_buy" | "schedule_sweep" | "schedule_give" }>,
    ): Promise<string> {
      parseCron(a.cron) // reject bad expressions before persisting
      const userId = a.idempotencyKey.split(":")[0] ?? "unknown"
      if (a.kind === "schedule_give") {
        const s = await store.create({
          userId,
          kind: "give",
          exchange: "strike",
          usdCents: a.usdCents ?? 0n,
          address: a.address,
          recipientSlug: a.recipientSlug,
          recipientName: a.recipientName,
          purpose: a.purpose,
          verified: a.verified,
          cron: a.cron,
          estimatedSats: a.amountSats,
          sweepToWallet: false,
        })
        return s.id
      }
      const s =
        a.kind === "schedule_sweep"
          ? await store.create({
              userId,
              kind: "sweep",
              exchange: "strike",
              usdCents: 0n,
              address: a.address,
              keepSats: a.keepSats,
              maxSats: a.maxSats,
              cron: a.cron,
              estimatedSats: a.maxSats,
              sweepToWallet: false,
            })
          : await store.create({
              userId,
              kind: "buy",
              exchange: a.exchange,
              usdCents: a.usdCents,
              cron: a.cron,
              estimatedSats: a.estimatedSats,
              sweepToWallet: opts.sweepToWallet ?? false,
            })
      return s.id
    },
    async cancel(id: string): Promise<void> {
      await store.cancel(id)
    },
  }
}

/** Default sweep: make an invoice on the user's wallet, have the exchange pay it. */
export function makeSweep(
  getExchangePayer: (
    rails: Rails,
  ) => { payLightningInvoice(bolt11: string): Promise<{ paymentId: string }> } | null,
) {
  return async (_userId: string, rails: Rails, sats: Sats): Promise<string | null> => {
    const wallet: WalletRail | undefined = rails.wallet
    const payer = getExchangePayer(rails)
    if (!wallet || !payer) return null
    const inv = await wallet.makeInvoice({
      amountSats: sats,
      memo: "agentic-bitcoin sweep",
      expirySeconds: 600,
    })
    const { paymentId } = await payer.payLightningInvoice(inv.bolt11)
    return paymentId
  }
}
