import { shopDepsFor } from "@/lib/shop/deps"
import { feedFor } from "@/lib/shop/service"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const f = await feedFor(shopDepsFor(req), slug)
  if (!f) return NextResponse.json({ error: "not found" }, { status: 404 })
  return NextResponse.json(f, {
    headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=60" },
  })
}
