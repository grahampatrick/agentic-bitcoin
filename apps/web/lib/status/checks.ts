/**
 * Dependency checks for /status. Each check is a cheap, unauthenticated reachability probe with
 * a timeout; "reachable" means the service answered at all (a 401/402 is a healthy answer).
 * Pure over an injected fetch so it is unit-tested; the route caches results for 60 s.
 */
export type CheckState = "ok" | "degraded" | "down"
export interface CheckResult {
  name: string
  state: CheckState
  detail: string
  ms: number
}

export interface CheckDef {
  name: string
  url: string
  init?: RequestInit
  /** Which HTTP statuses count as healthy for this probe. */
  okStatuses: number[]
  /** Optional body validation on a 200. */
  validate?: (json: unknown) => boolean
}

export const CHECKS: readonly CheckDef[] = [
  {
    name: "Price feed (mempool.space)",
    url: "https://mempool.space/api/v1/prices",
    okStatuses: [200],
    validate: (j) => typeof (j as { USD?: unknown })?.USD === "number",
  },
  {
    name: "Wallet relay (relay.getalby.com)",
    url: "https://relay.getalby.com/v1",
    init: { headers: { accept: "application/nostr+json" } },
    okStatuses: [200],
  },
  { name: "Strike API", url: "https://api.strike.me/v1/rates/ticker", okStatuses: [200, 401, 403] },
  { name: "Bitrefill API", url: "https://api.bitrefill.com/v2/ping", okStatuses: [200, 401, 403] },
  // llm402.ai (from early research) does not resolve; LightningProx is a live L402 gateway. Override with L402_STATUS_URL.
  {
    name: "L402 provider (lightningprox.com)",
    url: process.env.L402_STATUS_URL ?? "https://lightningprox.com/",
    okStatuses: [200, 402, 404, 405],
  },
]

export async function runCheck(
  def: CheckDef,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 5_000,
  now: () => number = Date.now,
): Promise<CheckResult> {
  const t0 = now()
  try {
    const res = await fetchImpl(def.url, {
      ...def.init,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    })
    const ms = now() - t0
    if (!def.okStatuses.includes(res.status))
      return { name: def.name, state: "down", detail: `HTTP ${res.status}`, ms }
    if (def.validate && res.status === 200) {
      let ok = false
      try {
        ok = def.validate(await res.json())
      } catch {
        ok = false
      }
      if (!ok) return { name: def.name, state: "degraded", detail: "unexpected body", ms }
    }
    return {
      name: def.name,
      state: ms > 2_500 ? "degraded" : "ok",
      detail: `HTTP ${res.status}`,
      ms,
    }
  } catch (err) {
    return {
      name: def.name,
      state: "down",
      detail: (err as Error).name === "TimeoutError" ? "timeout" : "unreachable",
      ms: now() - t0,
    }
  }
}

export async function runAll(
  fetchImpl: typeof fetch = fetch,
  defs: readonly CheckDef[] = CHECKS,
): Promise<CheckResult[]> {
  return Promise.all(defs.map((d) => runCheck(d, fetchImpl)))
}

export function overall(results: CheckResult[]): CheckState {
  if (results.some((r) => r.state === "down")) return "down"
  if (results.some((r) => r.state === "degraded")) return "degraded"
  return "ok"
}

// --- 60 s cache, one per process ---------------------------------------------------------------
let cache: { at: number; results: CheckResult[] } | null = null
export async function cachedStatus(
  ttlMs = 60_000,
): Promise<{ at: string; overall: CheckState; results: CheckResult[] }> {
  const t = Date.now()
  if (!cache || t - cache.at > ttlMs) cache = { at: t, results: await runAll() }
  return {
    at: new Date(cache.at).toISOString(),
    overall: overall(cache.results),
    results: cache.results,
  }
}
