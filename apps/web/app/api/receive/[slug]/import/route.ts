import { shopDepsFor } from "@/lib/shop/deps"
import { importForMerchant } from "@/lib/shop/service"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  let body: {
    token: string
    csv?: string
    shopifyUrl?: string
    manifestHost?: string
    defaultGame?: string
    replace?: boolean
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ ok: false, error: "Expected JSON" }, { status: 400 })
  }
  const r = await importForMerchant(shopDepsFor(req), slug, body.token ?? "", body)
  return NextResponse.json(r, {
    status: r.ok ? 200 : 400,
    headers: { "cache-control": "no-store" },
  })
}
