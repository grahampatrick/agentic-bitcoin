import { cachedStatus } from "@/lib/status/checks"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** GET /api/status → { at, overall, results[] }; 60 s cache; 503 only when something is down. */
export async function GET(): Promise<NextResponse> {
  const s = await cachedStatus()
  return NextResponse.json(s, {
    status: s.overall === "down" ? 503 : 200,
    headers: { "cache-control": "no-store" },
  })
}
