/**
 * Schedules are data (ADR-0010). A schedule stores WHAT to do and WHEN; every firing becomes a
 * normal `buy_bitcoin` Action with `requestedBy: "schedule"`, so caps, allow-lists, the kill switch
 * and the ledger apply unchanged. There is no second payment path.
 */
import type { Cents, ExchangeName, Sats } from "@agentic-bitcoin/core"

export interface Schedule {
  id: string
  userId: string
  exchange: ExchangeName
  usdCents: Cents
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
