/** Storage boundary. The service layer depends on this interface, never on Supabase directly. */
import type { ContactKind } from "./contact"

export type WaitlistSource = "landing" | "text" | "unknown"

export interface WaitlistEntry {
  contact: string
  kind: ContactKind
  source: WaitlistSource
  /** ISO timestamp; injectable so tests are deterministic. */
  createdAt: string
}

export interface WaitlistStore {
  /** Persist a normalized entry. Returns false if the contact was already present (idempotent). */
  add(entry: WaitlistEntry): Promise<{ created: boolean }>
  has(contact: string): Promise<boolean>
  count(): Promise<number>
  /** Human-readable label for logs/health ("memory" | "supabase"). */
  readonly kind: string
}

/** In-memory store — the fallback when Supabase env is absent (local dev, CI, previews). */
export class InMemoryWaitlistStore implements WaitlistStore {
  readonly kind = "memory"
  private readonly rows = new Map<string, WaitlistEntry>()

  add(entry: WaitlistEntry): Promise<{ created: boolean }> {
    if (this.rows.has(entry.contact)) return Promise.resolve({ created: false })
    this.rows.set(entry.contact, entry)
    return Promise.resolve({ created: true })
  }

  has(contact: string): Promise<boolean> {
    return Promise.resolve(this.rows.has(contact))
  }

  count(): Promise<number> {
    return Promise.resolve(this.rows.size)
  }
}
