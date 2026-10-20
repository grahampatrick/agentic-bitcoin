import { getAddressStore } from "@/lib/receive/addresses"
import { claimReceivePaid, siteBaseUrl } from "@/lib/receive/service"
import { getReceiveStore } from "@/lib/receive/store"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** POST { paymentHash, preimage } — a browser wallet paid and handed back the preimage. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  let body: { paymentHash?: string; preimage?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ ok: false, error: "Expected JSON" }, { status: 400 })
  }
  const r = await claimReceivePaid(
    { store: getReceiveStore(), addresses: getAddressStore(), baseUrl: siteBaseUrl(req) },
    slug,
    String(body.paymentHash ?? ""),
    String(body.preimage ?? ""),
  )
  return NextResponse.json(r, {
    status: r.ok ? 200 : 400,
    headers: { "cache-control": "no-store" },
  })
}
