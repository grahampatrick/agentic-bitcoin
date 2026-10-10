import { shopDepsFor } from "@/lib/shop/deps"
import { type CheckoutInput, checkout } from "@/lib/shop/service"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

export async function POST(req: Request) {
  let body: CheckoutInput
  try {
    body = (await req.json()) as CheckoutInput
  } catch {
    return NextResponse.json({ ok: false, error: "Expected JSON" }, { status: 400 })
  }
  const r = await checkout(shopDepsFor(req), { ...body, buyerKey: undefined })
  return NextResponse.json(r, {
    status: r.ok ? 201 : 400,
    headers: { "cache-control": "no-store" },
  })
}
