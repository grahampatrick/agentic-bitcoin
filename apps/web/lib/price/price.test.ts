import { describe, expect, it } from "vitest"
import { DEFAULT_TTL_MS, PriceCache, PriceUnavailableError, fetchFreshQuote } from "./feed"
import { PriceParseError, formatSats, formatUsd, satsPerDollar, usdToCents } from "./money"
import { type SourceDef, parseCoinGecko, parseMempool } from "./sources"

const mempoolFixture = { time: 1759795200, USD: 118432, EUR: 101233 }
const coingeckoFixture = { bitcoin: { usd: 118432.17 } }

describe("money (integers only)", () => {
  it("converts decimal usd to integer cents, rounding", () => {
    expect(usdToCents(118432.17)).toBe(11843217)
    expect(usdToCents(118432)).toBe(11843200)
    expect(usdToCents(0.005)).toBe(1)
  })
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, "118432", null, undefined])(
    "rejects non-positive / non-numeric usd: %j",
    (v) => {
      expect(() => usdToCents(v)).toThrow(PriceParseError)
    },
  )
  it("computes whole sats per dollar", () => {
    expect(satsPerDollar(11843200)).toBe(844) // 1e8 / 118432 = 844.36…
    expect(satsPerDollar(10000)).toBe(1_000_000) // $100/BTC → 1M sats per dollar
    expect(Number.isInteger(satsPerDollar(11843217))).toBe(true)
  })
  it("rejects non-integer cents", () => {
    expect(() => satsPerDollar(118432.5)).toThrow(PriceParseError)
    expect(() => satsPerDollar(0)).toThrow(PriceParseError)
  })
  it("formats for display", () => {
    expect(formatUsd(11843217)).toBe("$118,432")
    expect(formatSats(844)).toBe("844")
    expect(formatSats(1_000_000)).toBe("1,000,000")
  })
})

describe("source parsers", () => {
  it("parses mempool.space", () => expect(parseMempool(mempoolFixture)).toBe(11843200))
  it("parses coingecko", () => expect(parseCoinGecko(coingeckoFixture)).toBe(11843217))
  it.each([{}, { USD: "x" }, null, { bitcoin: {} }])("throws on bad shape %j", (j) => {
    expect(() => parseMempool(j)).toThrow(PriceParseError)
    expect(() => parseCoinGecko(j)).toThrow(PriceParseError)
  })
})

function sources(primaryOk: boolean, fallbackOk: boolean): readonly SourceDef[] {
  return [
    {
      name: "mempool.space",
      url: "primary",
      parse: primaryOk
        ? parseMempool
        : () => {
            throw new PriceParseError("primary down")
          },
    },
    {
      name: "coingecko",
      url: "fallback",
      parse: fallbackOk
        ? parseCoinGecko
        : () => {
            throw new PriceParseError("fallback down")
          },
    },
  ]
}
const fetcher = async (url: string) => (url === "primary" ? mempoolFixture : coingeckoFixture)
const at = (iso: string) => () => new Date(iso)

describe("fetchFreshQuote", () => {
  it("uses the primary when it works", async () => {
    const q = await fetchFreshQuote({
      sources: sources(true, true),
      fetcher,
      now: at("2026-10-07T00:00:00Z"),
    })
    expect(q).toEqual({
      usdCents: 11843200,
      satsPerDollar: 844,
      asOf: "2026-10-07T00:00:00.000Z",
      source: "mempool.space",
      stale: false,
    })
  })
  it("falls back when the primary fails", async () => {
    const q = await fetchFreshQuote({ sources: sources(false, true), fetcher })
    expect(q.source).toBe("coingecko")
    expect(q.usdCents).toBe(11843217)
  })
  it("throws a typed error listing every cause when all fail", async () => {
    await expect(
      fetchFreshQuote({ sources: sources(false, false), fetcher }),
    ).rejects.toBeInstanceOf(PriceUnavailableError)
    await expect(
      fetchFreshQuote({ sources: sources(false, false), fetcher }),
    ).rejects.toMatchObject({
      code: "PRICE_UNAVAILABLE",
      causes: [expect.any(Error), expect.any(Error)],
    })
  })
  it("treats a fetcher failure (network) as a per-source failure", async () => {
    const flaky = async (url: string) => {
      if (url === "primary") throw new Error("ECONNRESET")
      return coingeckoFixture
    }
    const q = await fetchFreshQuote({ sources: sources(true, true), fetcher: flaky })
    expect(q.source).toBe("coingecko")
  })
})

describe("PriceCache", () => {
  it("caches within the TTL and refreshes after it", async () => {
    let calls = 0
    let t = Date.parse("2026-10-07T00:00:00Z")
    const counting = async (url: string) => {
      calls++
      return fetcher(url)
    }
    const cache = new PriceCache({
      sources: sources(true, true),
      fetcher: counting,
      now: () => new Date(t),
    })
    await cache.get()
    await cache.get()
    expect(calls).toBe(1)
    t += DEFAULT_TTL_MS - 1
    await cache.get()
    expect(calls).toBe(1)
    t += 2
    await cache.get()
    expect(calls).toBe(2)
  })
  it("serves the last known value as stale when upstreams die, and backs off", async () => {
    let up = true
    let t = 0
    const f = async (url: string) => {
      if (!up) throw new Error("down")
      return fetcher(url)
    }
    const cache = new PriceCache({
      sources: sources(true, true),
      fetcher: f,
      now: () => new Date(t),
      ttlMs: 1000,
    })
    const first = await cache.get()
    expect(first.stale).toBe(false)
    up = false
    t = 2000
    const second = await cache.get()
    expect(second).toMatchObject({ usdCents: first.usdCents, stale: true })
    // backoff: a quarter-TTL later we still don't re-fetch
    let calls = 0
    const counting = async (url: string) => {
      calls++
      return f(url)
    }
    const c2 = new PriceCache({
      sources: sources(true, true),
      fetcher: counting,
      now: () => new Date(t),
      ttlMs: 1000,
    })
    up = true
    await c2.get()
    up = false
    t += 1001
    await c2.get() // fails → stale, sets backoff
    const after = calls
    t += 100
    await c2.get() // within backoff window → no new call
    expect(calls).toBe(after)
  })
  it("throws when there is no last value at all", async () => {
    const cache = new PriceCache({ sources: sources(false, false), fetcher })
    await expect(cache.get()).rejects.toBeInstanceOf(PriceUnavailableError)
  })
  it("dedupes concurrent requests into one upstream call", async () => {
    let calls = 0
    const slow = async (url: string) => {
      calls++
      await new Promise((r) => setTimeout(r, 5))
      return fetcher(url)
    }
    const cache = new PriceCache({ sources: sources(true, true), fetcher: slow })
    await Promise.all([cache.get(), cache.get(), cache.get()])
    expect(calls).toBe(1)
  })
})
