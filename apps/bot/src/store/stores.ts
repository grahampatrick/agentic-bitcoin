/**
 * Per-user state the dispatcher needs: policy, ledger, history, pending, and the (encrypted)
 * wallet secret. Policy and secret stores live in core since M23 (the web reads the same rows);
 * history and the ledger factory stay here; Supabase in supabase.ts.
 */
import type { LlmMessage } from "@agentic-bitcoin/agent"
import type { LedgerStore } from "@agentic-bitcoin/core"

export type { PolicyStore, SecretName, SecretStore } from "@agentic-bitcoin/core"
export { InMemoryPolicyStore, InMemorySecretStore } from "@agentic-bitcoin/core"

export interface HistoryStore {
  get(userId: string): Promise<LlmMessage[]>
  set(userId: string, history: LlmMessage[]): Promise<void>
}

export interface LedgerStoreFactory {
  forUser(userId: string): LedgerStore
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
