import { planDepsFor } from "@/lib/plans/deps"
import { requestPlanInvoice } from "@/lib/plans/service"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** M24: "Pay now" on the merchant's plan page → the open plan invoice's pay link. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  let body: { token?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ ok: false, error: "Expected JSON" }, { status: 400 })
  }
  const r = await requestPlanInvoice(planDepsFor(req), slug, body.token ?? "")
  return NextResponse.json(r, {
    status: r.ok ? 200 : 400,
    headers: { "cache-control": "no-store" },
  })
}
