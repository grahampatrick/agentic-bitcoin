import { shopDepsFor } from "@/lib/shop/deps"
import { removeProduct, upsertProduct } from "@/lib/shop/service"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  let body: { token: string; product?: Parameters<typeof upsertProduct>[3]; remove?: string }
  try {
    body = (await req.json()) as {
      token: string
      product?: Parameters<typeof upsertProduct>[3]
      remove?: string
    }
  } catch {
    return NextResponse.json({ ok: false, error: "Expected JSON" }, { status: 400 })
  }
  const r = await (body.remove
    ? removeProduct(shopDepsFor(req), slug, body.token ?? "", body.remove)
    : upsertProduct(
        shopDepsFor(req),
        slug,
        body.token ?? "",
        body.product ?? ({} as Parameters<typeof upsertProduct>[3]),
      ))
  return NextResponse.json(r, {
    status: r.ok ? 200 : 400,
    headers: { "cache-control": "no-store" },
  })
}
