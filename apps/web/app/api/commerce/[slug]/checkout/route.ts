import { shopDepsFor } from "@/lib/shop/deps"
import { checkout } from "@/lib/shop/service"
import type { CheckoutRequest } from "@agentic-bitcoin/core"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

/** The protocol's checkout for one of OUR directory merchants: items (+ plain shipping) → their invoice. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  let body: CheckoutRequest
  try {
    body = (await req.json()) as CheckoutRequest
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 })
  }
  if (body.anvard !== "0.1")
    return NextResponse.json({ error: "unsupported protocol version" }, { status: 400 })
  const r = await checkout(shopDepsFor(req), {
    merchantSlug: slug,
    items: body.items ?? [],
    shipping: body.shipping,
    contact: body.contact,
  })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json(
    {
      anvard: "0.1",
      orderId: r.orderId,
      bolt11: r.bolt11,
      paymentHash: r.paymentHash,
      amountSats: r.totalSats,
      totalCents: r.totalCents,
      expiresAt: new Date(Date.now() + r.expiresInSeconds * 1000).toISOString(),
      fulfilment: (body.items ?? []).length ? "shipped" : "instant",
    },
    { status: 201, headers: { "access-control-allow-origin": "*" } },
  )
}
