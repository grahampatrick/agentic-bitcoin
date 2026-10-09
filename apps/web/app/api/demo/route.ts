import {
  AnthropicLlmClient,
  ScriptedLlmClient,
  initialSandbox,
  packState,
  sandboxTurn,
  unpackState,
} from "@agentic-bitcoin/agent"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const live = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)
const llm = live ? new AnthropicLlmClient() : new ScriptedLlmClient()
const fallback = new ScriptedLlmClient()

/**
 * POST { state?: string, text: string } → { reply, deliveries, pending, ledger, state, model }
 * Stateless: the browser holds the sandbox state between turns. Fake sats; real policy, executor,
 * ledger and confirmation protocol. With an API key on the server, the real model runs.
 */
export async function POST(req: Request): Promise<NextResponse> {
  let body: { state?: string; text?: string }
  try {
    body = (await req.json()) as { state?: string; text?: string }
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 })
  }
  const text = (body.text ?? "").toString().slice(0, 500)
  if (!text.trim()) return NextResponse.json({ error: "Say something" }, { status: 400 })
  let state = initialSandbox()
  if (body.state) {
    try {
      state = unpackState(body.state)
      if (state.version !== 1 || state.events.length > 200) state = initialSandbox()
    } catch {
      state = initialSandbox()
    }
  }
  let model = live ? "claude-opus-5-5" : "scripted"
  let note: string | null = null
  try {
    let t: Awaited<ReturnType<typeof sandboxTurn>>
    try {
      t = await sandboxTurn(llm, state, text)
    } catch (err) {
      if (!live) throw err
      // The model is unavailable (billing, rate limit, outage): keep the demo alive on the scripted
      // model and say so. Policy, executor and ledger are unaffected either way.
      console.error(
        "[demo] model call failed, falling back to scripted:",
        err instanceof Error ? err.message.slice(0, 200) : err,
      )
      model = "scripted (model unavailable)"
      note =
        "The live model is unavailable right now; a scripted model is understanding your messages. The rules are still real."
      t = await sandboxTurn(fallback, state, text)
    }
    return NextResponse.json({
      reply: t.reply,
      deliveries: t.deliveries,
      pending: t.pending ?? null,
      toolCalls: t.toolCalls,
      ledger: t.ledger.map((e) => ({
        id: e.id,
        at: e.at,
        outcome: e.outcome,
        summary: e.decision.summary,
        requestedBy: e.action.requestedBy,
        kind: e.action.kind,
        detail: e.detail ?? e.error ?? null,
      })),
      wallet: { sats: t.state.walletSats, onchainSats: t.state.onchainSats },
      policy: {
        dailyCapSats: t.state.policy.dailyCapSats.toString(),
        perActionCapSats: t.state.policy.perActionCapSats.toString(),
        confirmAboveSats: t.state.policy.confirmAboveSats.toString(),
      },
      state: packState(t.state),
      model,
      note,
    })
  } catch (err) {
    console.error("[demo]", err instanceof Error ? err.message : err)
    return NextResponse.json(
      { error: "The sandbox hit an error. Reload to start over." },
      { status: 500 },
    )
  }
}

export async function GET(): Promise<NextResponse> {
  const s = initialSandbox()
  return NextResponse.json({
    state: packState(s),
    wallet: { sats: s.walletSats, onchainSats: s.onchainSats },
    model: live ? "claude-opus-5-5" : "scripted",
  })
}
