import { reportGift } from "@/lib/campaigns/service"
import { getCampaignStore } from "@/lib/campaigns/store"
import { getReceiveStore } from "@/lib/receive/store"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  let body: { token: string; campaign: string; sats: string; at?: string }
  try {
    body = (await req.json()) as { token: string; campaign: string; sats: string; at?: string }
  } catch {
    return NextResponse.json({ ok: false, error: "Expected JSON" }, { status: 400 })
  }
  const deps = { campaigns: getCampaignStore(), receive: getReceiveStore() }
  const r = await reportGift(
    deps,
    slug,
    body.token ?? "",
    body.campaign ?? "",
    body.sats ?? "",
    body.at,
  )
  return NextResponse.json(r, {
    status: r.ok ? 200 : 400,
    headers: { "cache-control": "no-store" },
  })
}
