import { shopDepsFor } from "@/lib/shop/deps"
import { rewardsForAddress } from "@/lib/shop/service"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** GET ?address=name@domain → what that address has earned (pending / payable / paid). */
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address") ?? ""
  const r = await rewardsForAddress(shopDepsFor(req), address)
  if (!r) return NextResponse.json({ error: "Enter a Lightning address" }, { status: 400 })
  return NextResponse.json(r, { headers: { "cache-control": "no-store" } })
}
