import { shopDepsFor } from "@/lib/shop/deps"
import { manifestOf } from "@/lib/shop/service"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const m = await manifestOf(shopDepsFor(req), slug)
  if (!m) return NextResponse.json({ error: "not found" }, { status: 404 })
  return NextResponse.json(m, {
    headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=300" },
  })
}
