/**
 * Schedules are data (ADR-0010). A schedule stores WHAT to do and WHEN; every firing becomes a
 * normal `buy_bitcoin` Action with `requestedBy: "schedule"`, so caps, allow-lists, the kill switch
 * and the ledger apply unchanged. There is no second payment path.
 */
import type { Cents, ExchangeName, GivePurpose, Sats } from "@agentic-bitcoin/core"

export type ScheduleKind = "buy" | "sweep" | "give"

export interface Schedule {
  id: string
  userId: string
  kind: ScheduleKind
  /** buy */
  exchange: ExchangeName
  usdCents: Cents
  /** sweep (M8): move balance above keepSats to the cold address, up to maxSats per run */
  address?: string
  keepSats?: Sats
  maxSats?: Sats
  /** give (M9): recurring gift to a directory recipient; `address` holds the Lightning address at creation,
   *  `estimatedSats` the sats per firing (re-priced from usdCents when usdCents > 0). Re-resolved at fire time. */
  recipientSlug?: string
  recipientName?: string
  purpose?: GivePurpose
  /** Trust at creation; the runner re-checks it against the directory before every firing. */
  verified?: boolean
  /** M11: the campaign a recurring gift supports, and the supporter's opt-in name. */
  campaignSlug?: string
  supporterName?: string
  cron: string
  /** Sats estimate captured at creation, re-estimated at each run from the live price when available. */
  estimatedSats: Sats
  /** After a buy, make an invoice on the user's wallet and have the exchange pay it. */
  sweepToWallet: boolean
  active: boolean
  createdAt: string
  /** The minute (ISO, seconds zeroed) of the last firing, so a run is never repeated for one slot. */
  lastRunAt: string | null
}

export interface ScheduleStore {
  readonly kind: string
  create(s: Omit<Schedule, "id" | "createdAt" | "lastRunAt" | "active">): Promise<Schedule>
  get(id: string): Promise<Schedule | null>
  listActive(): Promise<Schedule[]>
  listForUser(userId: string): Promise<Schedule[]>
  cancel(id: string): Promise<void>
  markRun(id: string, at: string): Promise<void>
}

export class InMemoryScheduleStore implements ScheduleStore {
  readonly kind = "memory"
  private readonly m = new Map<string, Schedule>()
  private seq = 0
  constructor(private readonly now: () => Date = () => new Date()) {}
  async create(s: Omit<Schedule, "id" | "createdAt" | "lastRunAt" | "active">): Promise<Schedule> {
    const full: Schedule = {
      ...s,
      id: `sch_${++this.seq}`,
      createdAt: this.now().toISOString(),
      lastRunAt: null,
      active: true,
    }
    this.m.set(full.id, full)
    return full
  }
  async get(id: string) {
    return this.m.get(id) ?? null
  }
  async listActive() {
    return [...this.m.values()].filter((s) => s.active)
  }
  async listForUser(userId: string) {
    return [...this.m.values()].filter((s) => s.userId === userId)
  }
  async cancel(id: string) {
    const s = this.m.get(id)
    if (s) s.active = false
  }
  async markRun(id: string, at: string) {
    const s = this.m.get(id)
    if (s) s.lastRunAt = at
  }
}
