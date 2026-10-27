import { updateProfile } from "@/lib/merchant/service"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  let body: {
    token?: string
    name?: string
    website?: string
    country?: string
    description?: string
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ ok: false, error: "Expected JSON" }, { status: 400 })
  }
  const r = await updateProfile(slug, body.token ?? "", body)
  return NextResponse.json(r, {
    status: r.ok ? 200 : 400,
    headers: { "cache-control": "no-store" },
  })
}
