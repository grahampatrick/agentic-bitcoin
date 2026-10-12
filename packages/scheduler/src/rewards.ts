/**
 * Reward payouts (M13, ADR-0017): payable sats-back is paid from the OPERATOR's wallet through the
 * same executor as every other spend — the operator's policy (daily cap, kill switch) and the
 * operator's ledger apply. Chat buyers are paid to an invoice minted on their own paired wallet;
 * web buyers to the Lightning address they gave at checkout. Idempotent per batch of reward ids.
 */
import {
  type Action,
  type ExecuteResult,
  type LedgerStore,
  type Policy,
  type Rails,
  type Reward,
  type RewardRates,
  type RewardStore,
  type Sats,
  actionHash,
  execute,
  payoutBatches,
} from "@agentic-bitcoin/core"

export interface RewardPayoutDeps {
  store: RewardStore
  rates: Pick<RewardRates, "minPayoutSats">
  /** The operator's own policy, ledger and wallet. */
  operator: { policy: Policy; ledger: LedgerStore; rails: Rails }
  /** An invoice for `sats` that the payee controls: their paired wallet (userId) or their address. */
  invoiceFor(
    payee: { userId?: string; payoutAddress?: string },
    sats: Sats,
  ): Promise<{ bolt11: string } | null>
  now?: () => Date
  log?: (line: string) => void
}

export interface RewardPayoutReport {
  paid: { payee: string; sats: Sats; rewards: number; paymentHash?: string }[]
  skipped: { payee: string; reason: string }[]
}

export async function runRewardPayouts(deps: RewardPayoutDeps): Promise<RewardPayoutReport> {
  const now = deps.now ?? (() => new Date())
  const log = deps.log ?? (() => {})
  const report: RewardPayoutReport = { paid: [], skipped: [] }
  const batches = payoutBatches(await deps.store.listOpen(), now(), deps.rates.minPayoutSats)
  for (const b of batches) {
    const payee = b.payee.userId ?? b.payee.payoutAddress ?? "?"
    let inv: { bolt11: string } | null
    try {
      inv = await deps.invoiceFor(b.payee, b.totalSats)
    } catch (err) {
      inv = null
      log(`rewards: no invoice for ${payee}: ${(err as Error).message}`)
    }
    if (!inv) {
      report.skipped.push({ payee, reason: "no invoice (wallet unreachable or no payout address)" })
      continue
    }
    const ids = b.rewards.map((r) => r.id).sort()
    const action: Action = {
      kind: "pay_invoice",
      bolt11: inv.bolt11,
      amountSats: b.totalSats,
      destination: `reward:${payee}`,
      idempotencyKey: `reward:${ids.join("+")}`,
      requestedBy: "schedule",
    }
    const at = now()
    const result: ExecuteResult = await execute({
      action,
      policy: deps.operator.policy,
      ledger: deps.operator.ledger,
      rails: deps.operator.rails,
      now: () => at,
      confirmation: {
        actionHash: actionHash(action),
        confirmedBy: "rewards",
        at: at.toISOString(),
      },
    })
    if (result.status === "succeeded") {
      const hash = (result.result as { paymentHash?: string } | undefined)?.paymentHash
      for (const r of b.rewards) {
        const paid: Reward = { ...r, state: "paid", paidAt: at.toISOString(), paymentHash: hash }
        await deps.store.update(paid)
      }
      report.paid.push({ payee, sats: b.totalSats, rewards: b.rewards.length, paymentHash: hash })
      log(`rewards: paid ${b.totalSats} sats to ${payee} (${b.rewards.length} rewards)`)
    } else {
      const reason =
        result.status === "denied"
          ? `denied: ${result.decision.reason}`
          : result.status === "failed"
            ? `failed: ${result.error}`
            : result.status
      report.skipped.push({ payee, reason })
      log(`rewards: ${payee}: ${reason}`)
      // mark payable so the summary tells the user it is owed, even when the operator wallet could not pay today
      for (const r of b.rewards)
        if (r.state === "pending") await deps.store.update({ ...r, state: "payable" })
    }
  }
  return report
}
