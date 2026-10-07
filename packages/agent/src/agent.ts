/**
 * The agent loop. One turn = the user's text → (model ⇄ tools)* → a reply.
 *
 * Every tool call becomes an Action and goes through core `execute` with the user's policy,
 * ledger and rails resolved server-side (`UserContext`). The model never sees secrets. A
 * `needs_confirmation` decision parks the action in the PendingStore under its hash; the user
 * (via a surface) or the model (via confirm_action, only after an explicit yes) releases it.
 */
import {
  type Action,
  type Confirmation,
  type ExecuteResult,
  type LedgerStore,
  type Policy,
  type PriceSnapshot,
  type Rails,
  execute,
} from "@agentic-bitcoin/core"
import type { LlmClient, LlmContentBlock, LlmMessage, LlmTool } from "./llm"
import { SYSTEM_PROMPT } from "./prompt"
import { TOOLS, ToolInputError, quoteUntrusted, toolToAction } from "./tools"

export interface PendingStore {
  set(userId: string, actionHash: string, action: Action): Promise<void>
  get(userId: string, actionHash: string): Promise<Action | null>
  delete(userId: string, actionHash: string): Promise<void>
  /** The most recent pending action for a user, for plain "yes" replies. */
  latest(userId: string): Promise<{ actionHash: string; action: Action } | null>
}

export class InMemoryPendingStore implements PendingStore {
  private readonly m = new Map<string, Map<string, Action>>()
  async set(u: string, h: string, a: Action) {
    if (!this.m.has(u)) this.m.set(u, new Map())
    this.m.get(u)?.set(h, a)
  }
  async get(u: string, h: string) {
    return this.m.get(u)?.get(h) ?? null
  }
  async delete(u: string, h: string) {
    this.m.get(u)?.delete(h)
  }
  async latest(u: string) {
    const entries = [...(this.m.get(u)?.entries() ?? [])]
    const last = entries.at(-1)
    return last ? { actionHash: last[0], action: last[1] } : null
  }
}

export interface UserContext {
  userId: string
  policy: Policy
  ledger: LedgerStore
  rails: Rails
  pending: PendingStore
  schedules?: Parameters<typeof execute>[0]["schedules"]
}

export interface AgentDeps {
  llm: LlmClient
  resolveContext(userId: string): Promise<UserContext>
  price(): Promise<PriceSnapshot | undefined>
  now?: () => Date
  /** Per-turn safety valve on model⇄tool iterations. */
  maxIterations?: number
}

export interface TurnResult {
  reply: string
  history: LlmMessage[]
  /** Set when the turn ended with an action parked for confirmation. */
  pending?: { actionHash: string; summary: string }
  toolCalls: { name: string; status: string }[]
}

const LLM_TOOLS: LlmTool[] = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.input_schema,
  strict: true,
}))

/** bigint-safe JSON for tool results. */
export function toToolJson(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x))
}

export async function runTurn(
  deps: AgentDeps,
  userId: string,
  text: string,
  history: LlmMessage[],
): Promise<TurnResult> {
  const now = deps.now ?? (() => new Date())
  const ctx = await deps.resolveContext(userId)
  const price = await deps.price()
  const messages: LlmMessage[] = [...history, { role: "user", content: text }]
  const toolCalls: TurnResult["toolCalls"] = []
  let pending: TurnResult["pending"]
  const max = deps.maxIterations ?? 6

  for (let i = 0; i < max; i++) {
    const res = await deps.llm.complete({ system: SYSTEM_PROMPT, messages, tools: LLM_TOOLS })
    const assistantContent = res.content
    messages.push({ role: "assistant", content: assistantContent })

    if (res.stop_reason === "refusal") {
      return { reply: "I can't help with that request.", history: messages, toolCalls, pending }
    }
    const uses = assistantContent.filter(
      (b): b is Extract<LlmContentBlock, { type: "tool_use" }> => b.type === "tool_use",
    )
    if (res.stop_reason !== "tool_use" || uses.length === 0) {
      return { reply: textOf(assistantContent), history: messages, toolCalls, pending }
    }

    const results: Extract<LlmMessage["content"], unknown[]>[number][] = []
    for (const use of uses) {
      const r = await handleToolCall(ctx, use.name, use.input, {
        callId: `${userId}:${use.id}`,
        price,
        now,
      })
      toolCalls.push({ name: use.name, status: r.status })
      if ("actionHash" in r) pending = { actionHash: r.actionHash, summary: r.summary }
      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: r.content,
        is_error: r.isError,
      })
    }
    messages.push({ role: "user", content: results })
  }
  return {
    reply: "I stopped before finishing; please try a smaller request.",
    history: messages,
    toolCalls,
    pending,
  }
}

function textOf(blocks: LlmContentBlock[]): string {
  return blocks
    .filter((b): b is Extract<LlmContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim()
}

type ToolOutcome =
  | {
      status: "awaiting_confirmation"
      actionHash: string
      summary: string
      content: string
      isError: false
    }
  | { status: string; content: string; isError: boolean }

/** Execute one tool call through policy; the result is what the model sees. */
export async function handleToolCall(
  ctx: UserContext,
  name: string,
  input: unknown,
  opts: { callId: string; price?: PriceSnapshot; now: () => Date },
): Promise<ToolOutcome> {
  let action: Action | null
  try {
    action = toolToAction(name, input, {
      callId: opts.callId,
      requestedBy: "agent",
      price: opts.price,
    })
  } catch (err) {
    const msg = err instanceof ToolInputError ? err.message : "invalid tool input"
    return {
      status: "invalid_input",
      content: toToolJson({ status: "invalid_input", error: msg }),
      isError: true,
    }
  }

  if (action === null) {
    const hash =
      typeof (input as { action_hash?: unknown })?.action_hash === "string"
        ? (input as { action_hash: string }).action_hash
        : ""
    return confirmPending(ctx, hash, {
      confirmedBy: `${ctx.userId} (via model)`,
      price: opts.price,
      now: opts.now,
    })
  }

  const result = await execute({
    action,
    policy: ctx.policy,
    ledger: ctx.ledger,
    rails: ctx.rails,
    schedules: ctx.schedules,
    now: opts.now,
    context: { price: opts.price },
  })
  return outcomeOf(ctx, action, result)
}

/** Release a parked action with a confirmation bound to its hash. Used by surfaces ("yes") and by the model. */
export async function confirmPending(
  ctx: UserContext,
  actionHash: string,
  opts: { confirmedBy: string; price?: PriceSnapshot; now: () => Date },
): Promise<ToolOutcome> {
  const action = actionHash ? await ctx.pending.get(ctx.userId, actionHash) : null
  if (!action) {
    return {
      status: "no_pending_action",
      content: toToolJson({
        status: "no_pending_action",
        error: "no action is awaiting confirmation with that hash",
      }),
      isError: true,
    }
  }
  const confirmation: Confirmation = {
    actionHash,
    confirmedBy: opts.confirmedBy,
    at: opts.now().toISOString(),
  }
  const result = await execute({
    action,
    policy: ctx.policy,
    ledger: ctx.ledger,
    rails: ctx.rails,
    schedules: ctx.schedules,
    now: opts.now,
    context: { price: opts.price },
    confirmation,
  })
  if (result.status !== "awaiting_confirmation") await ctx.pending.delete(ctx.userId, actionHash)
  return outcomeOf(ctx, action, result)
}

async function outcomeOf(
  ctx: UserContext,
  action: Action,
  result: ExecuteResult,
): Promise<ToolOutcome> {
  switch (result.status) {
    case "awaiting_confirmation": {
      await ctx.pending.set(ctx.userId, result.decision.actionHash, action)
      return {
        status: "awaiting_confirmation",
        actionHash: result.decision.actionHash,
        summary: result.decision.summary,
        content: toToolJson({
          status: "awaiting_confirmation",
          summary: result.decision.summary,
          action_hash: result.decision.actionHash,
          instruction:
            "Relay the summary to the user verbatim and ask them to reply yes or no. Do not call confirm_action until they have said yes.",
        }),
        isError: false,
      }
    }
    case "denied":
      return {
        status: "denied",
        content: toToolJson({
          status: "denied",
          reason: result.decision.reason,
          summary: result.decision.summary,
        }),
        isError: true,
      }
    case "failed":
      return {
        status: "failed",
        content: toToolJson({ status: "failed", code: result.code, error: result.error }),
        isError: true,
      }
    case "succeeded":
      return {
        status: "succeeded",
        content: toToolJson({
          status: "succeeded",
          summary: result.decision.summary,
          result: sanitize(result.result),
          replayed: result.replayed ?? false,
        }),
        isError: false,
      }
  }
}

/** Strip secrets and wrap external text before it reaches the model. */
function sanitize(result: unknown): unknown {
  if (!result || typeof result !== "object") return result
  const r = { ...(result as Record<string, unknown>) }
  if (typeof r.preimage === "string") r.preimage = `${r.preimage.slice(0, 8)}…`
  if (typeof r.body === "string") r.body = quoteUntrusted(r.body)
  if (r.order && typeof r.order === "object") {
    const o = { ...(r.order as Record<string, unknown>) }
    if (typeof o.redemption === "string")
      o.redemption = "[delivered — sent to you directly, not shown here]"
    r.order = o
  }
  return r
}
