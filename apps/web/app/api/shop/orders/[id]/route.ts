import { shopDepsFor } from "@/lib/shop/deps"
import { claimPaid, orderStatus } from "@/lib/shop/service"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const v = await orderStatus(shopDepsFor(req), id)
  if (!v) return NextResponse.json({ error: "not found" }, { status: 404 })
  return NextResponse.json(v, { headers: { "cache-control": "no-store" } })
}

/** POST { preimage } — the buyer's proof of payment. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: { preimage?: string }
  try {
    body = (await req.json()) as { preimage?: string }
  } catch {
    return NextResponse.json({ ok: false, error: "Expected JSON" }, { status: 400 })
  }
  const r = await claimPaid(shopDepsFor(req), id, String(body.preimage ?? ""))
  return NextResponse.json(r, {
    status: r.ok ? 200 : 400,
    headers: { "cache-control": "no-store" },
  })
}
