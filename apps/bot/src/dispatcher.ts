/**
 * The dispatcher: turns inbound chat messages into agent turns, commands, or confirmation
 * decisions. Surface-agnostic. Commands never go through the model (they change policy, which the
 * model is not allowed to touch — ADR-0008).
 */
import { type AgentDeps, type UserContext, confirmPending, runTurn } from "@agentic-bitcoin/agent"
import {
  DEFAULT_POLICY,
  type Policy,
  formatCents,
  formatSats,
  readEntries,
  satsToCents,
  spentSince,
  windowStart,
} from "@agentic-bitcoin/core"
import { type HistoryStore, type PolicyStore, trimHistory } from "./store/stores"
import type { ChatSurface, InboundMessage } from "./surfaces/surface"

export interface DispatcherDeps {
  surface: ChatSurface
  agent: Omit<AgentDeps, "resolveContext">
  resolveContext(userId: string): Promise<UserContext>
  policies: PolicyStore
  history: HistoryStore
  now?: () => Date
}

const YES = /^(y|yes|yep|yeah|confirm|approve|ok|okay|do it)[.!]?$/i
const NO = /^(n|no|nope|cancel|stop|deny)[.!]?$/i

export class Dispatcher {
  private readonly now: () => Date
  constructor(private readonly deps: DispatcherDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  async start(): Promise<void> {
    await this.deps.surface.start((m) => this.handle(m))
  }

  async handle(m: InboundMessage): Promise<void> {
    const reply = (text: string, confirm?: { actionHash: string }) =>
      this.deps.surface.send(m.userId, { text, confirm })
    const text = m.text.trim()
    try {
      if (m.decision)
        return await this.decide(m.userId, m.decision.actionHash, m.decision.approve, reply)
      if (text.startsWith("/")) return await this.command(m.userId, text, reply)
      if (YES.test(text) || NO.test(text)) {
        const ctx = await this.deps.resolveContext(m.userId)
        const latest = await ctx.pending.latest(m.userId)
        if (latest) return await this.decide(m.userId, latest.actionHash, YES.test(text), reply)
      }
      const history = await this.deps.history.get(m.userId)
      const result = await runTurn(
        { ...this.deps.agent, resolveContext: this.deps.resolveContext },
        m.userId,
        text,
        history,
      )
      await this.deps.history.set(m.userId, trimHistory(result.history))
      await reply(
        result.reply || "(no reply)",
        result.pending ? { actionHash: result.pending.actionHash } : undefined,
      )
    } catch (err) {
      console.error("[dispatcher]", err)
      await reply("Something went wrong on my side. Nothing was sent. Try again in a moment.")
    }
  }

  private async decide(
    userId: string,
    actionHash: string,
    approve: boolean,
    reply: (t: string) => Promise<void>,
  ): Promise<void> {
    const ctx = await this.deps.resolveContext(userId)
    if (!approve) {
      await ctx.pending.delete(userId, actionHash)
      return reply("Cancelled. Nothing was sent.")
    }
    const price = await this.deps.agent.price()
    const out = await confirmPending(ctx, actionHash, { confirmedBy: userId, price, now: this.now })
    const parsed = JSON.parse(out.content) as {
      status: string
      summary?: string
      error?: string
      code?: string
      result?: { preimage?: string }
    }
    if (parsed.status === "succeeded")
      return reply(
        `Done. ${parsed.summary ?? ""}${parsed.result?.preimage ? ` Preimage ${parsed.result.preimage}` : ""}`.trim(),
      )
    if (parsed.status === "no_pending_action")
      return reply("That approval has expired or was already used.")
    return reply(
      `Not done: ${parsed.error ?? parsed.status}${parsed.code ? ` (${parsed.code})` : ""}.`,
    )
  }

  private async command(
    userId: string,
    text: string,
    reply: (t: string) => Promise<void>,
  ): Promise<void> {
    const [cmd, ...args] = text.split(/\s+/)
    const ctx = await this.deps.resolveContext(userId)
    switch (cmd?.toLowerCase()) {
      case "/start":
      case "/help":
        return reply(
          "I run bitcoin actions through your own wallet. Text me in plain words, e.g. “pay 500 sats to gm@getalby.com” or “what's my balance?”.\n/budget — show or set limits\n/kill — stop everything\n/resume — lift the kill switch\n/ledger — last actions",
        )
      case "/kill": {
        await this.deps.policies.set(userId, { ...ctx.policy, killSwitch: true })
        return reply("Kill switch ON. Nothing moves until you send /resume.")
      }
      case "/resume": {
        await this.deps.policies.set(userId, { ...ctx.policy, killSwitch: false })
        return reply("Kill switch off. Your limits still apply.")
      }
      case "/budget": {
        if (args.length === 0) return reply(describePolicy(ctx.policy))
        const next = applyBudgetArgs(ctx.policy, args)
        if (!next.ok) return reply(next.error)
        await this.deps.policies.set(userId, next.policy)
        return reply(`Updated.\n${describePolicy(next.policy)}`)
      }
      case "/ledger": {
        const entries = await readEntries(ctx.ledger)
        const price = await this.deps.agent.price()
        const spent = spentSince(entries, windowStart(this.now()))
        const lines = entries
          .slice(-8)
          .reverse()
          .map(
            (e) =>
              `${e.at.slice(5, 16).replace("T", " ")} ${e.outcome.padEnd(9)} ${e.decision.summary}`,
          )
        const fiat = price ? ` (≈ ${formatCents(satsToCents(spent, price))})` : ""
        return reply(
          `Last 24h: ${formatSats(spent)}${fiat} of ${formatSats(ctx.policy.dailyCapSats)}.\n${lines.join("\n") || "No actions yet."}`,
        )
      }
      default:
        return reply("Unknown command. /help lists them.")
    }
  }
}

export function describePolicy(p: Policy): string {
  const rails = Object.entries(p.rails)
    .filter(([, on]) => on)
    .map(([k]) => k)
    .join(", ")
  return [
    `Daily cap ${formatSats(p.dailyCapSats)} · per action ${formatSats(p.perActionCapSats)} · confirm at ${formatSats(p.confirmAboveSats)}`,
    `Rails on: ${rails || "none"}${p.killSwitch ? " · KILL SWITCH ON" : ""}`,
    p.allowDestinations.length
      ? `Allow: ${p.allowDestinations.join(", ")}`
      : "Allow: anyone not denied",
    p.denyDestinations.length ? `Deny: ${p.denyDestinations.join(", ")}` : "",
    "Set with: /budget daily 50000 · /budget action 20000 · /budget confirm 5000 · /budget allow name@domain · /budget deny *.evil.example · /budget rail exchange on",
  ]
    .filter(Boolean)
    .join("\n")
}

/** `/budget daily 50000` etc. Pure, so it is unit-tested without a surface. */
export function applyBudgetArgs(
  p: Policy,
  args: string[],
): { ok: true; policy: Policy } | { ok: false; error: string } {
  const [key, ...rest] = args
  const n = () => {
    const v = rest[0] ?? ""
    if (!/^\d{1,12}$/.test(v)) return null
    return BigInt(v)
  }
  switch (key?.toLowerCase()) {
    case "daily": {
      const v = n()
      return v === null
        ? { ok: false, error: "Usage: /budget daily <sats>" }
        : { ok: true, policy: { ...p, dailyCapSats: v } }
    }
    case "action": {
      const v = n()
      return v === null
        ? { ok: false, error: "Usage: /budget action <sats>" }
        : { ok: true, policy: { ...p, perActionCapSats: v } }
    }
    case "confirm": {
      const v = n()
      return v === null
        ? { ok: false, error: "Usage: /budget confirm <sats>" }
        : { ok: true, policy: { ...p, confirmAboveSats: v } }
    }
    case "allow": {
      const d = rest[0]?.toLowerCase()
      if (!d) return { ok: false, error: "Usage: /budget allow <destination>" }
      return {
        ok: true,
        policy: { ...p, allowDestinations: [...new Set([...p.allowDestinations, d])] },
      }
    }
    case "unallow": {
      const d = rest[0]?.toLowerCase()
      return {
        ok: true,
        policy: { ...p, allowDestinations: p.allowDestinations.filter((x) => x !== d) },
      }
    }
    case "deny": {
      const d = rest[0]?.toLowerCase()
      if (!d) return { ok: false, error: "Usage: /budget deny <destination>" }
      return {
        ok: true,
        policy: { ...p, denyDestinations: [...new Set([...p.denyDestinations, d])] },
      }
    }
    case "rail": {
      const rail = rest[0]?.toLowerCase() as keyof Policy["rails"] | undefined
      const on = rest[1]?.toLowerCase()
      if (!rail || !(rail in p.rails) || (on !== "on" && on !== "off"))
        return { ok: false, error: "Usage: /budget rail <wallet|exchange|goods|compute> on|off" }
      return { ok: true, policy: { ...p, rails: { ...p.rails, [rail]: on === "on" } } }
    }
    default:
      return {
        ok: false,
        error:
          "Usage: /budget [daily|action|confirm <sats> | allow|deny <dest> | rail <name> on|off]",
      }
  }
}

export { DEFAULT_POLICY }
