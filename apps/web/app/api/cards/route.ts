import { createCardFromWeb } from "@/lib/cards/service"
import { getCardStore } from "@/lib/cards/store"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** POST: make a virtual card from the store. Unowned until claimed from chat (ADR-0021). */
export async function POST(req: Request) {
  let body: Parameters<typeof createCardFromWeb>[1]
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ ok: false, error: "Expected JSON" }, { status: 400 })
  }
  const siteUrl = process.env.SITE_URL ?? new URL(req.url).origin
  const r = await createCardFromWeb(getCardStore(), body, siteUrl)
  return NextResponse.json(r, {
    status: r.ok ? 200 : 400,
    headers: { "cache-control": "no-store" },
  })
}
