import { shopDepsFor } from "@/lib/shop/deps"
import { fulfilOrder, merchantOrders } from "@/lib/shop/service"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  let body: { token: string; fulfil?: { orderId: string; note?: string } }
  try {
    body = (await req.json()) as { token: string; fulfil?: { orderId: string; note?: string } }
  } catch {
    return NextResponse.json({ ok: false, error: "Expected JSON" }, { status: 400 })
  }
  const r = await (body.fulfil
    ? fulfilOrder(shopDepsFor(req), slug, body.token ?? "", body.fulfil.orderId, body.fulfil.note)
    : merchantOrders(shopDepsFor(req), slug, body.token ?? "").then((list) =>
        list
          ? { ok: true as const, orders: list }
          : { ok: false as const, error: "Not authorized." },
      ))
  return NextResponse.json(r, {
    status: r.ok ? 200 : 400,
    headers: { "cache-control": "no-store" },
  })
}
