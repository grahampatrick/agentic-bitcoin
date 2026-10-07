/**
 * Per-user state the dispatcher needs: policy, ledger, history, pending, and the (encrypted)
 * wallet secret. Interfaces here; memory implementations for dev/tests; Supabase in supabase.ts.
 */
import type { LlmMessage } from "@agentic-bitcoin/agent"
import type { LedgerStore, Policy } from "@agentic-bitcoin/core"

export interface PolicyStore {
  get(userId: string): Promise<Policy | null>
  set(userId: string, policy: Policy): Promise<void>
}

export interface SecretStore {
  /** Returns the encrypted blob; the caller decrypts with SECRETS_KEY. */
  get(userId: string, name: "nwc"): Promise<string | null>
  set(userId: string, name: "nwc", blob: string): Promise<void>
}

export interface HistoryStore {
  get(userId: string): Promise<LlmMessage[]>
  set(userId: string, history: LlmMessage[]): Promise<void>
}

export interface LedgerStoreFactory {
  forUser(userId: string): LedgerStore
}

export class InMemoryPolicyStore implements PolicyStore {
  private readonly m = new Map<string, Policy>()
  async get(u: string) {
    return this.m.get(u) ?? null
  }
  async set(u: string, p: Policy) {
    this.m.set(u, p)
  }
}

export class InMemorySecretStore implements SecretStore {
  private readonly m = new Map<string, string>()
  async get(u: string, n: string) {
    return this.m.get(`${u}:${n}`) ?? null
  }
  async set(u: string, n: string, b: string) {
    this.m.set(`${u}:${n}`, b)
  }
}

export class InMemoryHistoryStore implements HistoryStore {
  private readonly m = new Map<string, LlmMessage[]>()
  async get(u: string) {
    return this.m.get(u) ?? []
  }
  async set(u: string, h: LlmMessage[]) {
    this.m.set(u, h)
  }
}

/** Keep the last N user-text turns, never cutting a tool_use/tool_result pair. */
export function trimHistory(history: LlmMessage[], keepTurns = 12): LlmMessage[] {
  const starts: number[] = []
  history.forEach((m, i) => {
    if (m.role === "user" && typeof m.content === "string") starts.push(i)
  })
  if (starts.length <= keepTurns) return history
  return history.slice(starts[starts.length - keepTurns])
}
