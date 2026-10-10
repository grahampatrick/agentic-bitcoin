import { shopDepsFor } from "@/lib/shop/deps"
import { viewProducts } from "@/lib/shop/service"
import { parseGlobalProductId } from "@agentic-bitcoin/core"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** GET ?ids=dir:m:a,dir:m:b → product views (for the cart). */
export async function GET(req: Request) {
  const deps = shopDepsFor(req)
  const ids = (new URL(req.url).searchParams.get("ids") ?? "")
    .split(",")
    .filter(Boolean)
    .slice(0, 50)
  const found = []
  for (const gid of ids) {
    const parts = parseGlobalProductId(gid)
    const p = parts ? await deps.products.get(parts.merchantSlug, parts.id) : null
    if (p) found.push(p)
  }
  return NextResponse.json(
    { products: await viewProducts(deps, found) },
    { headers: { "cache-control": "no-store" } },
  )
}
