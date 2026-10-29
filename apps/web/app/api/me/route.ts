import { applyMeOp } from "@/lib/me/service"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** The workspace's writes (M23). The token travels in the body, never in the URL. */
export async function POST(req: Request) {
  let body: { token?: string } & Record<string, unknown>
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ ok: false, error: "Expected JSON" }, { status: 400 })
  }
  const r = await applyMeOp(typeof body.token === "string" ? body.token : undefined, body)
  return NextResponse.json(
    r.ok
      ? {
          ok: true,
          card: r.card,
          policy: r.policy
            ? {
                dailyCapSats: r.policy.dailyCapSats.toString(),
                perActionCapSats: r.policy.perActionCapSats.toString(),
                confirmAboveSats: r.policy.confirmAboveSats.toString(),
                killSwitch: r.policy.killSwitch,
                rails: r.policy.rails,
                allowDestinations: r.policy.allowDestinations,
                denyDestinations: r.policy.denyDestinations,
              }
            : undefined,
        }
      : r,
    { status: r.ok ? 200 : 400, headers: { "cache-control": "no-store" } },
  )
}
