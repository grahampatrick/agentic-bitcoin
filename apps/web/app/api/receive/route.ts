import { type OnboardForm, onboardRecipient, siteBaseUrl } from "@/lib/receive/service"
import { getReceiveStore } from "@/lib/receive/store"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

/** POST the onboarding form → { ok, slug, lightningAddress, dashboardToken } (token shown once). */
export async function POST(req: Request) {
  let form: OnboardForm
  try {
    form = (await req.json()) as OnboardForm
  } catch {
    return NextResponse.json({ ok: false, error: "Expected JSON" }, { status: 400 })
  }
  const r = await onboardRecipient({ store: getReceiveStore(), baseUrl: siteBaseUrl(req) }, form)
  return NextResponse.json(r, {
    status: r.ok ? 201 : 400,
    headers: { "cache-control": "no-store" },
  })
}
