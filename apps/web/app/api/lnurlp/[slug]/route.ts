import { payRequestFor, siteBaseUrl } from "@/lib/receive/service"
import { getReceiveStore } from "@/lib/receive/store"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** LNURL-pay discovery: /.well-known/lnurlp/<slug> rewrites here. */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const body = await payRequestFor({ store: getReceiveStore(), baseUrl: siteBaseUrl(req) }, slug)
  return NextResponse.json(body, {
    status: "status" in body ? 404 : 200,
    headers: { "access-control-allow-origin": "*", "cache-control": "no-store" },
  })
}
