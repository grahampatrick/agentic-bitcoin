import { shopDepsFor } from "@/lib/shop/deps"
import { orderStatus } from "@/lib/shop/service"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const v = await orderStatus(shopDepsFor(req), id)
  if (!v) return NextResponse.json({ error: "not found" }, { status: 404 })
  return NextResponse.json(
    {
      anvard: "0.1",
      orderId: v.id,
      state: v.state,
      paymentHash: v.paymentHash,
      paidAt: v.paidAt,
      fulfilledAt: v.fulfilledAt,
      note: v.note,
    },
    { headers: { "access-control-allow-origin": "*", "cache-control": "no-store" } },
  )
}
