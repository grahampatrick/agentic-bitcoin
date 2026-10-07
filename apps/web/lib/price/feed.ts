/**
 * The price feed: try sources in order, cache the first success for `ttlMs`, and when every
 * source fails serve the last known value (marked stale) rather than an error. The page must never
 * show a spinner or a broken number because a free API hiccuped.
 */
import { satsPerDollar } from "./money"
import { DEFAULT_SOURCES, type PriceSource, type SourceDef } from "./sources"

export interface PriceQuote {
  /** Integer cents. */
  usdCents: number
  /** Integer sats per one US dollar. */
  satsPerDollar: number
  /** ISO timestamp of when this value was fetched upstream. */
  asOf: string
  source: PriceSource
  /** True when every upstream failed and this is the last known value. */
  stale: boolean
}

export class PriceUnavailableError extends Error {
  readonly code = "PRICE_UNAVAILABLE"
  constructor(readonly causes: readonly Error[]) {
    super(`all price sources failed: ${causes.map((c) => c.message).join("; ")}`)
    this.name = "PriceUnavailableError"
  }
}

export type Fetcher = (url: string) => Promise<unknown>

export interface FeedOptions {
  sources?: readonly SourceDef[]
  fetcher?: Fetcher
  ttlMs?: number
  now?: () => Date
  timeoutMs?: number
}

export const DEFAULT_TTL_MS = 60_000

export function defaultFetcher(timeoutMs: number): Fetcher {
  return async (url) => {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json", "user-agent": "agentic-bitcoin/0.0 (+landing price)" },
      cache: "no-store",
    })
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
    return res.json()
  }
}

/** Pure: fetch from the first source that answers with a parseable price. */
export async function fetchFreshQuote(opts: FeedOptions = {}): Promise<PriceQuote> {
  const sources = opts.sources ?? DEFAULT_SOURCES
  const fetcher = opts.fetcher ?? defaultFetcher(opts.timeoutMs ?? 4_000)
  const now = opts.now ?? (() => new Date())
  const causes: Error[] = []
  for (const s of sources) {
    try {
      const usdCents = s.parse(await fetcher(s.url))
      return {
        usdCents,
        satsPerDollar: satsPerDollar(usdCents),
        asOf: now().toISOString(),
        source: s.name,
        stale: false,
      }
    } catch (err) {
      causes.push(err instanceof Error ? err : new Error(String(err)))
    }
  }
  throw new PriceUnavailableError(causes)
}

/** A tiny TTL cache with last-known-value fallback. One instance per process (see `getPrice`). */
export class PriceCache {
  private last: PriceQuote | null = null
  private fetchedAt = 0
  private inflight: Promise<PriceQuote> | null = null

  constructor(private readonly opts: FeedOptions = {}) {}

  async get(): Promise<PriceQuote> {
    const now = this.opts.now ?? (() => new Date())
    const ttl = this.opts.ttlMs ?? DEFAULT_TTL_MS
    const t = now().getTime()
    if (this.last && t - this.fetchedAt < ttl) return this.last
    if (this.inflight) return this.inflight

    this.inflight = fetchFreshQuote(this.opts)
      .then((q) => {
        this.last = q
        this.fetchedAt = t
        return q
      })
      .catch((err: unknown) => {
        if (this.last) {
          // Serve stale, but don't hammer upstream: back off for a quarter TTL.
          this.fetchedAt = t - ttl + Math.floor(ttl / 4)
          return { ...this.last, stale: true }
        }
        throw err
      })
      .finally(() => {
        this.inflight = null
      })
    return this.inflight
  }

  /** Test-only. */
  __reset(): void {
    this.last = null
    this.fetchedAt = 0
    this.inflight = null
  }
}

let singleton: PriceCache | null = null

/** Process-wide cache used by both the server-rendered page and the API route. */
export function getPriceCache(): PriceCache {
  if (!singleton) singleton = new PriceCache()
  return singleton
}

export function getPrice(): Promise<PriceQuote> {
  return getPriceCache().get()
}
