/**
 * Replace the bitcoin you spend (M19, ADR-0022): for one user, find the spends the ledger says
 * are not yet replaced, buy each back on the user's own exchange through core `execute` (policy,
 * ledger, idempotency all apply), and sweep the sats into the wallet when the rule says so. Runs
 * right after a turn that spent, and after a scheduled gift fires; there is no polling loop over
 * users because every spend already passes through one of those two doors.
 */
import {
  type Action,
  type ExecuteResult,
  type LedgerStore,
  type Policy,
  type PriceSnapshot,
  type Rails,
  type Sats,
  actionHash,
  execute,
  readEntries,
  replacementsDue,
} from "@agentic-bitcoin/core"

export interface ReplaceDeps {
  resolve(userId: string): Promise<{ policy: Policy; ledger: LedgerStore; rails: Rails }>
  price(): Promise<PriceSnapshot | undefined>
  /** Pays an invoice minted on the user's wallet from the exchange. Optional. */
  sweep?: (userId: string, rails: Rails, sats: Sats) => Promise<string | null>
  now?: () => Date
  log?: (line: string) => void
}

export interface ReplaceReport {
  userId: string
  done: {
    entryId: string
    status: ExecuteResult["status"]
    /** Sats the spend took, for the message. */
    spentSats: Sats
    boughtSats?: Sats
    usdCents?: bigint
    swept?: boolean
    detail?: string
  }[]
}

export async function runReplacementsFor(
  userId: string,
  deps: ReplaceDeps,
): Promise<ReplaceReport> {
  const now = deps.now ?? (() => new Date())
  const log = deps.log ?? (() => {})
  const report: ReplaceReport = { userId, done: [] }
  const { policy, ledger, rails } = await deps.resolve(userId)
  const rule = policy.replaceSpend
  if (!rule?.enabled) return report
  const price = await deps.price()
  if (!price) {
    log(`replace ${userId}: no price; skipped`)
    return report
  }
  const at = now()
  const due = replacementsDue(await readEntries(ledger), rule, price, at)
  for (const d of due) {
    const action: Action = d.action
    // The user turned the rule on with /replace; each buy it causes is pre-approved like a schedule firing.
    const result = await execute({
      action,
      policy,
      ledger,
      rails,
      now: () => at,
      context: { price },
      confirmation: {
        actionHash: actionHash(action),
        confirmedBy: `replace:${userId}`,
        at: at.toISOString(),
      },
    })
    const spentSats = spendOf(d.entry.action)
    const row: ReplaceReport["done"][number] = {
      entryId: d.entry.id,
      status: result.status,
      spentSats,
    }
    if (result.status === "succeeded") {
      const ex = result.result as { sats?: Sats; usdCents?: bigint } | undefined
      row.boughtSats = ex?.sats
      row.usdCents = ex?.usdCents
      if (rule.toWallet && deps.sweep && ex?.sats && ex.sats > 0n) {
        try {
          row.swept = (await deps.sweep(userId, rails, ex.sats)) !== null
        } catch (err) {
          row.swept = false
          row.detail = `bought, but the sweep to your wallet failed: ${(err as Error).message}`
        }
      }
    } else
      row.detail =
        result.status === "denied"
          ? result.decision.reason
          : result.status === "failed"
            ? result.error
            : result.status
    report.done.push(row)
    log(`replace ${userId} ${d.entry.id}: ${result.status} ${row.detail ?? ""}`.trim())
  }
  return report
}

function spendOf(a: Action): Sats {
  return "amountSats" in a ? (a.amountSats as Sats) : 0n
}
