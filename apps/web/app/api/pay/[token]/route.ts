import { invoiceDepsFor } from "@/lib/invoices/deps"
import { claimInvoicePaid, payView } from "@/lib/invoices/service"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const v = await payView(invoiceDepsFor(req), token.toLowerCase())
  if (!v) return NextResponse.json({ error: "not found" }, { status: 404 })
  return NextResponse.json(v, { headers: { "cache-control": "no-store" } })
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  let body: { preimage?: string }
  try {
    body = (await req.json()) as { preimage?: string }
  } catch {
    return NextResponse.json({ ok: false, error: "Expected JSON" }, { status: 400 })
  }
  const r = await claimInvoicePaid(
    invoiceDepsFor(req),
    token.toLowerCase(),
    String(body.preimage ?? ""),
  )
  return NextResponse.json(r, {
    status: r.ok ? 200 : 400,
    headers: { "cache-control": "no-store" },
  })
}
