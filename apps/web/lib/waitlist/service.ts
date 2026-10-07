import { classifyContact, normalizeContact } from "./contact"
import { WaitlistError } from "./errors"
import { InMemoryWaitlistStore, type WaitlistSource, type WaitlistStore } from "./store"
import { SupabaseWaitlistStore } from "./supabaseStore"

export interface JoinInput {
  contact: string
  source?: WaitlistSource
  /** Injectable clock for deterministic tests. Defaults to now. */
  now?: () => Date
}

export interface JoinResult {
  ok: true
  created: boolean
  kind: "email" | "npub"
  storeKind: string
}

/**
 * The one function the API route calls. Validates → normalizes → persists.
 * Throws {@link WaitlistError} on any expected failure — never returns a silent falsy.
 */
export async function joinWaitlist(input: JoinInput, store: WaitlistStore): Promise<JoinResult> {
  const contact = normalizeContact(input.contact ?? "")
  const kind = classifyContact(contact)
  if (!kind) throw WaitlistError.invalidContact()

  const now = input.now ?? (() => new Date())
  const { created } = await store.add({
    contact,
    kind,
    source: input.source ?? "landing",
    createdAt: now().toISOString(),
  })

  if (!created) throw WaitlistError.alreadyJoined()
  return { ok: true, created, kind, storeKind: store.kind }
}

// --- store selection (the only place env is read) -------------------------------------------

let singleton: WaitlistStore | null = null

export function getWaitlistStore(): WaitlistStore {
  if (singleton) return singleton
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (url && key) {
    singleton = new SupabaseWaitlistStore(url, key)
  } else {
    if (process.env.NODE_ENV !== "test") {
      console.warn(
        "[waitlist] SUPABASE_URL/SERVICE_ROLE_KEY not set — using in-memory store (non-durable).",
      )
    }
    singleton = new InMemoryWaitlistStore()
  }
  return singleton
}

/** Test-only reset of the singleton. */
export function __resetWaitlistStore(): void {
  singleton = null
}
