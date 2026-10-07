import { PriceUnavailableError, getPrice } from "@/lib/price/feed"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/price → { usdCents, satsPerDollar, asOf, source, stale }
 * Server-side cached (60s) so the free upstreams are never hit from browsers directly.
 * Never leaks an upstream error body to the page; 503 only when there is no value at all.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const q = await getPrice()
    return NextResponse.json(q, {
      headers: { "cache-control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300" },
    })
  } catch (err) {
    if (err instanceof PriceUnavailableError) {
      console.error("[price] all sources failed:", err.message)
      return NextResponse.json({ error: "Price temporarily unavailable." }, { status: 503 })
    }
    console.error("[price] unexpected error", err)
    return NextResponse.json({ error: "Price temporarily unavailable." }, { status: 503 })
  }
}
