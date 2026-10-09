/**
 * The dispatcher: turns inbound chat messages into agent turns, commands, confirmation decisions,
 * or onboarding steps. Surface-agnostic. Commands never go through the model (they change policy
 * and credentials, which the model is not allowed to touch — ADR-0008). Secrets never reach the
 * model or the history: a message that looks like one is intercepted before `runTurn`.
 */
import { type AgentDeps, type UserContext, confirmPending, runTurn } from "@agentic-bitcoin/agent"
import {
  DEFAULT_POLICY,
  type Policy,
  formatCents,
  formatSats,
  parseAddress,
  readEntries,
  satsToCents,
  spentSince,
  windowStart,
} from "@agentic-bitcoin/core"
import {
  decryptSecret,
  encryptSecret,
  maskSecret,
  validateConnectionString,
} from "@agentic-bitcoin/rails"
import {
  KEY_HELP,
  PAIR_HELP,
  type WalletProbe,
  type WizardState,
  assessPairing,
  looksLikeSecret,
  parseKeyCommand,
  startWizard,
  wizardStep,
} from "./onboarding"
import {
  type HistoryStore,
  type PolicyStore,
  type SecretName,
  type SecretStore,
  trimHistory,
} from "./store/stores"
import type { ChatSurface, InboundMessage } from "./surfaces/surface"

export interface DispatcherDeps {
  surface: ChatSurface
  agent: Omit<AgentDeps, "resolveContext">
  resolveContext(userId: string): Promise<UserContext>
  policies: PolicyStore
  history: HistoryStore
  secrets: SecretStore
  /** 32-byte key; without it pairing and key entry are disabled (nothing is stored in plaintext). */
  secretsKey: Buffer | null
  /** Connects to a wallet string and reports what it can do. Injected so tests never touch a relay. */
  probeWallet(connectionString: string): Promise<WalletProbe>
  /** Called after a pairing/key change so cached rails for the user are rebuilt. */
  onCredentialsChanged?(userId: string): void
  /** When set, a new number must send this code first (a "select group" gate like Instinct's). */
  inviteCode?: string
  /** When set, messages from any other user id are ignored entirely (linked-device testing). */
  allowedUsers?: readonly string[]
  now?: () => Date
}

const YES = /^(y|yes|yep|yeah|confirm|approve|ok|okay|do it)[.!]?$/i
const NO = /^(n|no|nope|cancel|stop|deny)[.!]?$/i

export class Dispatcher {
  private readonly now: () => Date
  private readonly wizards = new Map<string, WizardState>()
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
    if (this.deps.allowedUsers?.length && !this.deps.allowedUsers.includes(m.userId)) return
    try {
      if (m.decision)
        return await this.decide(m.userId, m.decision.actionHash, m.decision.approve, reply)
      if (text.startsWith("/")) return await this.command(m, text, reply)
      if (looksLikeSecret(text)) {
        await this.redact(m)
        return reply(
          "That looks like a wallet connection string or an API key. I never pass those to the model. Use /pair <string> or /key <strike|bitrefill> <key> instead, and delete that message.",
        )
      }
      const wizard = this.wizards.get(m.userId)
      if (!wizard && (await this.deps.policies.get(m.userId)) === null)
        return await this.firstContact(m.userId, text, reply)
      if (wizard) return await this.wizard(m.userId, wizard, text, reply)
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
      for (const d of result.deliveries) await reply(d)
    } catch (err) {
      console.error("[dispatcher]", err instanceof Error ? err.message : err)
      await reply("Something went wrong on my side. Nothing was sent. Try again in a moment.")
    }
  }

  /** A number we have never seen: gate on the invite code if configured, then greet and start the limits wizard. */
  private async firstContact(
    userId: string,
    text: string,
    reply: (t: string) => Promise<void>,
  ): Promise<void> {
    const code = this.deps.inviteCode?.trim()
    if (code && text.trim().toLowerCase() !== code.toLowerCase()) {
      return reply(
        "Hey! Glad you're here. Agentic Bitcoin is working with a small group right now while we ramp up. If someone gave you an invite code, send it here and you're in. Otherwise you're on the list and I'll message you the moment a spot opens. Nothing else you need to do.",
      )
    }
    const w = startWizard()
    this.wizards.set(userId, w.state)
    return reply(
      `Hey! Glad you're here. I'm Agentic Bitcoin: text me in plain words and I'll move bitcoin through your own wallet, within limits you set. Nothing moves without your limits, and anything over your threshold waits for your yes.\n\n${w.prompt}`,
    )
  }

  private async redact(m: InboundMessage): Promise<void> {
    if (m.messageId && this.deps.surface.redact)
      await this.deps.surface.redact(m.userId, m.messageId)
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
    if (parsed.status === "succeeded") {
      await reply(
        `Done. ${parsed.summary ?? ""}${parsed.result?.preimage ? ` Preimage ${parsed.result.preimage}` : ""}`.trim(),
      )
      if (out.deliverToUser) await reply(out.deliverToUser)
      return
    }
    if (parsed.status === "no_pending_action")
      return reply("That approval has expired or was already used.")
    return reply(
      `Not done: ${parsed.error ?? parsed.status}${parsed.code ? ` (${parsed.code})` : ""}.`,
    )
  }

  private async wizard(
    userId: string,
    state: WizardState,
    text: string,
    reply: (t: string) => Promise<void>,
  ): Promise<void> {
    const next = wizardStep(state, text)
    if (next.state) this.wizards.set(userId, next.state)
    else this.wizards.delete(userId)
    if (next.policy) await this.deps.policies.set(userId, next.policy)
    return reply(next.prompt)
  }

  private async command(
    m: InboundMessage,
    text: string,
    reply: (t: string) => Promise<void>,
  ): Promise<void> {
    const userId = m.userId
    const [cmd, ...args] = text.split(/\s+/)
    const ctx = await this.deps.resolveContext(userId)
    switch (cmd?.toLowerCase()) {
      case "/start": {
        if ((await this.deps.policies.get(userId)) === null) {
          const w = startWizard()
          this.wizards.set(userId, w.state)
          return reply(
            `Hi. I run bitcoin actions through your own wallet, within limits you set.\n${w.prompt}`,
          )
        }
        return reply(HELP)
      }
      case "/help":
        return reply(HELP)
      case "/setup": {
        const w = startWizard(ctx.policy)
        this.wizards.set(userId, w.state)
        return reply(w.prompt)
      }
      case "/pair":
        return this.pair(m, args, reply)
      case "/unpair": {
        await this.deps.secrets.delete(userId, "nwc")
        this.deps.onCredentialsChanged?.(userId)
        return reply("Wallet unpaired. Also revoke the connection in your wallet app.")
      }
      case "/key":
        return this.key(m, args, reply)
      case "/cold":
        return this.cold(userId, args, ctx.policy, reply)
      case "/kill": {
        this.wizards.delete(userId)
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

  private async pair(
    m: InboundMessage,
    args: string[],
    reply: (t: string) => Promise<void>,
  ): Promise<void> {
    const allowUnbudgeted = args[0]?.toLowerCase() === "unbudgeted"
    const url = allowUnbudgeted ? args[1] : args[0]
    if (!url) return reply(PAIR_HELP)
    await this.redact(m) // the message holds a secret: remove it first, whatever happens next
    if (!this.deps.secretsKey)
      return reply("Pairing is disabled on this server (no SECRETS_KEY). Ask the operator.")
    try {
      validateConnectionString(url)
    } catch (err) {
      return reply(`Not a usable connection string: ${(err as Error).message}\n${PAIR_HELP}`)
    }
    let probe: WalletProbe
    try {
      probe = await this.deps.probeWallet(url)
    } catch (err) {
      return reply(`I could not reach that wallet: ${(err as Error).message}`)
    }
    const verdict = assessPairing(probe, { allowUnbudgeted })
    if (!verdict.ok) return reply(verdict.error)
    await this.deps.secrets.set(m.userId, "nwc", encryptSecret(url, this.deps.secretsKey))
    this.deps.onCredentialsChanged?.(m.userId)
    return reply(
      `${verdict.description}\nI have deleted your message if I could; delete it yourself otherwise. Try: what's my balance?`,
    )
  }

  /** Register (or show) the cold-storage address sweeps may go to. Only allow-listed addresses can receive a sweep. */
  private async cold(
    userId: string,
    args: string[],
    policy: Policy,
    reply: (t: string) => Promise<void>,
  ): Promise<void> {
    const addr = args[0]?.trim()
    const current = policy.coldStorageAddresses
    if (!addr) {
      return reply(
        current.length
          ? `Cold storage: ${current.join(", ")}\nAsk me to “sweep everything above 200000 sats to cold storage” or “sweep monthly”. Remove with /cold remove <address>.`
          : "No cold-storage address yet. Send: /cold <bitcoin address> (one from your hardware wallet). Sweeps can only go to addresses you register here.",
      )
    }
    if (addr.toLowerCase() === "remove") {
      const target = args[1]?.trim()
      if (!target) return reply("Usage: /cold remove <address>")
      await this.deps.policies.set(userId, {
        ...policy,
        coldStorageAddresses: policy.coldStorageAddresses.filter((d) => d !== target.toLowerCase()),
      })
      return reply("Removed.")
    }
    try {
      const parsed = await parseAddress(addr)
      const next = {
        ...policy,
        coldStorageAddresses: [...new Set([...policy.coldStorageAddresses, addr.toLowerCase()])],
      }
      await this.deps.policies.set(userId, next)
      return reply(
        `Registered ${parsed.kind} address on ${parsed.network}: ${addr.slice(0, 10)}…${addr.slice(-6)}.${next.rails.onchain ? "" : " The on-chain rail is off: /budget rail onchain on"}\nEvery sweep still asks you to confirm.`,
      )
    } catch (err) {
      return reply(`That is not a valid bitcoin address (${(err as Error).message}).`)
    }
  }

  private async key(
    m: InboundMessage,
    args: string[],
    reply: (t: string) => Promise<void>,
  ): Promise<void> {
    const cmd = parseKeyCommand(args)
    if (cmd.kind === "error") return reply(`${cmd.error}\n${KEY_HELP}`)
    if (cmd.kind === "show") {
      if (!this.deps.secretsKey)
        return reply("Key storage is disabled on this server (no SECRETS_KEY).")
      const lines: string[] = []
      for (const name of ["strike", "bitrefill"] as SecretName[]) {
        const blob = await this.deps.secrets.get(m.userId, name)
        lines.push(
          `${name}: ${blob ? maskSecret(decryptSecret(blob, this.deps.secretsKey)) : "not set"}`,
        )
      }
      const nwc = await this.deps.secrets.get(m.userId, "nwc")
      lines.push(`wallet: ${nwc ? "paired" : "not paired (/pair)"}`)
      return reply(`${lines.join("\n")}\n\n${KEY_HELP}`)
    }
    await this.redact(m)
    if (!this.deps.secretsKey)
      return reply("Key storage is disabled on this server (no SECRETS_KEY).")
    if (cmd.kind === "remove") {
      await this.deps.secrets.delete(m.userId, cmd.name)
      this.deps.onCredentialsChanged?.(m.userId)
      return reply(`${cmd.name} key removed. Also revoke it on their site.`)
    }
    await this.deps.secrets.set(m.userId, cmd.name, encryptSecret(cmd.value, this.deps.secretsKey))
    this.deps.onCredentialsChanged?.(m.userId)
    const railFlag = cmd.name === "strike" ? "exchange" : "goods"
    const on = this.deps.policies.get(m.userId).then((p) => (p ?? DEFAULT_POLICY).rails[railFlag])
    return reply(
      `${cmd.name} key stored (${maskSecret(cmd.value)}). I deleted your message if I could; delete it yourself otherwise.${(await on) ? "" : `\nThe ${railFlag} rail is off in your limits: /budget rail ${railFlag} on`}`,
    )
  }
}

const HELP =
  "Text me in plain words, e.g. “pay 500 sats to gm@getalby.com” or “what's my balance?”.\n/setup — limits wizard\n/pair — connect your wallet\n/key — Strike / Bitrefill keys\n/cold — cold-storage address for sweeps\n/budget — show or set limits\n/kill — stop everything\n/resume — lift the kill switch\n/ledger — last actions"

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
    p.coldStorageAddresses.length ? `Cold storage: ${p.coldStorageAddresses.join(", ")}` : "",
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
        return {
          ok: false,
          error: "Usage: /budget rail <wallet|exchange|goods|compute|onchain> on|off",
        }
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
