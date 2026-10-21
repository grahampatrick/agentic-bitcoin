import { shopDepsFor } from "@/lib/shop/deps"
import { listMerchants } from "@/lib/shop/service"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** /.well-known/anvard.json on OUR host: a directory of merchant manifests (ours and remote shops). */
export async function GET(req: Request) {
  const deps = shopDepsFor(req)
  const merchants = await listMerchants(deps)
  const b = deps.baseUrl.replace(/\/$/, "")
  const out = []
  for (const m of merchants) {
    const r = await deps.receive.getRecipient(m.slug)
    out.push({
      slug: m.slug,
      name: m.name,
      manifest: r?.manifestHost
        ? `https://${r.manifestHost}/.well-known/anvard.json`
        : `${b}/api/commerce/${m.slug}/manifest`,
      products: m.productCount,
    })
  }
  return NextResponse.json(
    { anvard: "0.1", directory: out },
    { headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=300" } },
  )
}
