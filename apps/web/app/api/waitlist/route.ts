import { WaitlistError } from "@/lib/waitlist/errors"
import { getWaitlistStore, joinWaitlist } from "@/lib/waitlist/service"
import type { WaitlistSource } from "@/lib/waitlist/store"
import { NextResponse } from "next/server"

export const runtime = "nodejs"

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 })
  }
  const contact =
    typeof (body as { contact?: unknown })?.contact === "string"
      ? (body as { contact: string }).contact
      : ""
  const rawSource = (body as { source?: unknown })?.source
  const source: WaitlistSource | undefined =
    rawSource === "landing" || rawSource === "text" ? rawSource : undefined

  try {
    const result = await joinWaitlist({ contact, source }, getWaitlistStore())
    return NextResponse.json(
      { ok: true, created: result.created, kind: result.kind },
      { status: 201 },
    )
  } catch (err) {
    if (err instanceof WaitlistError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    console.error("[waitlist] unexpected error", err)
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 })
  }
}
