import { setCardState } from "@/lib/cards/service"
import { getCardStore } from "@/lib/cards/store"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: { token?: string; op?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ ok: false, error: "Expected JSON" }, { status: 400 })
  }
  if (body.op !== "pause" && body.op !== "resume")
    return NextResponse.json({ ok: false, error: "op must be pause or resume" }, { status: 400 })
  const r = await setCardState(getCardStore(), id, body.token ?? "", body.op)
  return NextResponse.json(r, {
    status: r.ok ? 200 : 400,
    headers: { "cache-control": "no-store" },
  })
}
