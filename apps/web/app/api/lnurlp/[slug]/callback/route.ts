import { invoiceFor, siteBaseUrl } from "@/lib/receive/service"
import { getReceiveStore } from "@/lib/receive/store"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

/** LNURL-pay callback: ?amount=<msats>&comment=… → { pr, routes: [] } from the recipient's wallet. */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const u = new URL(req.url)
  const amount = Number(u.searchParams.get("amount"))
  const comment = u.searchParams.get("comment") ?? undefined
  const campaign = u.searchParams.get("campaign") ?? undefined
  if (!Number.isInteger(amount) || amount <= 0)
    return NextResponse.json(
      { status: "ERROR", reason: "amount (msats) required" },
      { status: 400 },
    )
  const body = await invoiceFor(
    { store: getReceiveStore(), baseUrl: siteBaseUrl(req) },
    slug,
    amount,
    comment,
    campaign,
  )
  return NextResponse.json(body, {
    status: "status" in body ? 400 : 200,
    headers: { "access-control-allow-origin": "*", "cache-control": "no-store" },
  })
}
