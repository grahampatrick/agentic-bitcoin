import { createHash } from "node:crypto"
/**
 * The dispatcher: turns inbound chat messages into agent turns, confirmation decisions, or
 * onboarding steps. Surface-agnostic.
 *
 * M25 (ADR-0029): people talk in plain words. Four things stay in code and never reach the model:
 * a pasted secret (a wallet connection string or an API key is stored and redacted before
 * `runTurn`), "stop everything" (the kill switch, with no model call), a yes or a no (bound to the
 * parked action's hash), and the invite code at first contact. Views and settings are ordinary
 * tools (`show`, `change_setting`) served by the desk below. The slash commands still work as
 * aliases and share the same code; nothing teaches them any more.
 */
import {
  type AgentDeps,
  type UserContext,
  confirmPending,
  handleToolCall,
  runTurn,
} from "@agentic-bitcoin/agent"
import {
  type CampaignStore,
  type CardStore,
  DEFAULT_POLICY,
  type Desk,
  type DeskView,
  type InvoiceStore,
  type IssuedInvoice,
  type LedgerEntry,
  type LightningAddressStore,
  type OrderStore,
  type Policy,
  RAIL_LABEL,
  type Recipient,
  type RecipientStore,
  type ReferralRules,
  type ReferralStore,
  type RewardStore,
  type SettingChange,
  type VirtualCard,
  type WebLinkStore,
  campaignProgress,
  cardSpentSince,
  centsToSats,
  claimCard,
  formatCents,
  formatSats,
  givingRows,
  givingStatementCsv,
  hasSpent,
  hashWebToken,
  invoiceStatus,
  invoicesCsv,
  isLightningAddress,
  isTrustedRecipient,
  joinWithCode,
  normalizeAddressName,
  normalizeCode,
  parseAddress,
  paymentEntries,
  periodEnd,
  periodStart,
  readEntries,
  referralStats,
  referralsEnabled,
  replaceSetting,
  satsToCents,
  slugify,
  spentSince,
  summarizeRewards,
  webLinkExpiry,
  windowStart,
  workspaceUrl,
} from "@agentic-bitcoin/core"
import {
  decryptSecret,
  encryptSecret,
  maskSecret,
  validateConnectionString,
} from "@agentic-bitcoin/rails"
import { nextRun, parseCron } from "@agentic-bitcoin/scheduler"
import {
  type DeskDeps,
  applyReplaceArgs,
  budgetChange,
  describePolicy,
  joinTerms,
  planSetting,
} from "./desk"
import {
  KEY_HELP,
  KEY_STEPS,
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
  /** M9: the recipient directory (unscoped; the dispatcher scopes by user). Optional: without it giving commands are off. */
  recipients?: RecipientStore
  /** Checks a Lightning address answers LNURL-pay before a private recipient is saved. Injected so tests never hit the network. */
  probeAddress?(address: string): Promise<{ ok: true } | { ok: false; error: string }>
  /** User ids allowed to run operator commands (/verify). Empty = nobody. */
  operators?: readonly string[]
  /** Public site, for links to /receive and /give pages. */
  siteUrl?: string
  /** M11: campaigns (follow/unfollow, /campaigns). */
  campaigns?: CampaignStore
  /** M12: the user's storefront orders (by opaque buyer key). */
  orders?: OrderStore
  /** M13: the user's sats-back rewards. */
  rewardStore?: RewardStore
  /** M14: the user's issued invoices. */
  invoiceStore?: InvoiceStore
  /** M15: lightning addresses for paired users. */
  addresses?: LightningAddressStore
  /** M17a: virtual cards. */
  cards?: CardStore
  /** M19: runs after a turn or a confirmation that may have spent (replace-the-bitcoin-you-spend). */
  afterSpend?: (userId: string) => Promise<void>
  /** M22: referral rewards; off unless the rules pay at least one side. */
  referrals?: { store: ReferralStore; rules: ReferralRules; newId: () => string }
  /** M23: `/web` mints a link that opens the user's workspace on the site (ADR-0027). */
  webLinks?: { store: WebLinkStore; newToken: () => string; ttlDays?: number }
  buyerKeyOf?(userId: string): string
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

const YES =
  /^(y|yes|yep|yeah|yup|sure|confirm|approve|approved|ok|okay|do it|go ahead|yes please|yes do it|yes go ahead|please do)[.!]*$/i
const NO = /^(n|no|nope|cancel|stop|deny|don't|do not)[.!]*$/i
/** The kill switch in plain words. No model call: stopping must work when the model does not. */
const KILL =
  /^(stop everything|stop it all|stop all|kill|kill it|kill switch|freeze|freeze everything|halt|panic|emergency stop)[.!]*$/i
const STOP = /^stop[.!]*$/i
const NWC_RE = /nostr\+walletconnect:\/\/\S+/i
/** How long a pasted secret may wait in memory for one answer ("strike or bitrefill?"). Never stored. */
const HELD_MS = 5 * 60 * 1000
/** How long "paste your Strike key here" stays armed after the user asked to connect. */
const EXPECT_MS = 10 * 60 * 1000

type Held =
  | { kind: "key"; value: string; at: number }
  | { kind: "nwc-unbudgeted"; value: string; at: number }

export class Dispatcher {
  private readonly now: () => Date
  private readonly wizards = new Map<string, WizardState>()
  /** A pasted secret waiting for one answer. Memory only, a few minutes, cleared on use. */
  private readonly held = new Map<string, Held>()
  /** Which key the user said they are about to paste. */
  private readonly expecting = new Map<string, { name: "strike" | "bitrefill"; at: number }>()
  private readonly redacted = new WeakSet<InboundMessage>()
  private readonly deskDeps: DeskDeps
  constructor(private readonly deps: DispatcherDeps) {
    this.now = deps.now ?? (() => new Date())
    this.deskDeps = {
      policies: deps.policies,
      secrets: deps.secrets,
      recipients: deps.recipients,
      probeAddress: deps.probeAddress,
      campaigns: deps.campaigns,
      addresses: deps.addresses,
      referrals: deps.referrals,
      webLinks: deps.webLinks,
      siteUrl: deps.siteUrl,
      onCredentialsChanged: deps.onCredentialsChanged,
      resolveContext: deps.resolveContext,
      now: this.now,
    }
  }

  /** The user's context with the desk attached, so `show` and `change_setting` reach the stores. */
  private async ctxFor(userId: string): Promise<UserContext> {
    return { ...(await this.deps.resolveContext(userId)), desk: this.desk(userId) }
  }

  /** ADR-0029: the views and settings behind the two desk tools, for one user. */
  private desk(userId: string): Desk {
    const plan = (c: SettingChange) => planSetting(this.deskDeps, userId, c)
    return {
      show: (view, arg) => this.show(userId, view, arg),
      check: async (c) => {
        const p = await plan(c)
        return p.ok ? null : p.error
      },
      change: async (c) => {
        const p = await plan(c)
        if (!p.ok) throw new Error(p.error)
        return { text: await p.commit() }
      },
    }
  }

  /** What a slash command would have printed, as text. */
  private async printed(userId: string, command: string): Promise<string> {
    const out: string[] = []
    await this.command({ userId, text: command }, command, async (t) => {
      out.push(t)
    })
    return out.join("\n")
  }

  private async show(
    userId: string,
    view: DeskView,
    arg: string,
  ): Promise<{ text: string; direct?: string }> {
    switch (view) {
      case "activity":
        return { text: await this.printed(userId, "/ledger") }
      case "limits":
        return { text: await this.printed(userId, "/budget") }
      case "connections": {
        // never the secrets, not even masked: this text goes to the model
        const has = async (n: SecretName) => !!(await this.deps.secrets.get(userId, n))
        return {
          text: [
            `Wallet: ${(await has("nwc")) ? "connected" : "not connected"}`,
            `Strike key (buying bitcoin): ${(await has("strike")) ? "stored" : "not set"}`,
            `Bitrefill key (gift cards, top-ups): ${(await has("bitrefill")) ? "stored" : "not set"}`,
          ].join("\n"),
        }
      }
      case "orders":
        return { text: await this.printed(userId, "/orders") }
      case "notes":
        return { text: await this.printed(userId, "/notes") }
      case "giving_statement": {
        const year = /^\d{4}$/.test(arg) ? arg : ""
        const full = await this.printed(userId, `/statement ${year}`.trim())
        const [head = "", ...rest] = full.split("\n\n")
        return rest.length ? { text: head, direct: full } : { text: full }
      }
      case "invoices_csv": {
        const csv = await this.printed(userId, "/invoices csv")
        const rows = Math.max(0, csv.split("\n").length - 1)
        return rows > 0 && csv.includes(",")
          ? { text: `A CSV of ${rows} invoice${rows === 1 ? "" : "s"} was sent.`, direct: csv }
          : { text: csv }
      }
      case "lightning_address":
        return { text: await this.printed(userId, "/address") }
      case "campaigns":
        return { text: await this.printed(userId, "/campaigns") }
      case "replace":
        return { text: await this.printed(userId, "/replace") }
      case "workspace_link": {
        // a bearer link: straight to the human, never through the model or the history
        const link = await this.printed(userId, "/web")
        return link.includes("/me?t=")
          ? {
              text: "A private link to their workspace was sent. It opens for 30 days.",
              direct: link,
            }
          : { text: link }
      }
      case "shop":
        return { text: await this.printed(userId, "/shop") }
      case "receive":
        return { text: await this.printed(userId, "/receive") }
      case "connect_wallet":
        return { text: PAIR_HELP }
      case "connect_strike":
      case "connect_bitrefill": {
        const name = view === "connect_strike" ? "strike" : "bitrefill"
        this.expecting.set(userId, { name, at: this.now().getTime() })
        return { text: KEY_STEPS[name] }
      }
    }
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
      if (looksLikeSecret(text)) return await this.secret(m, text, reply)
      const held = this.takeHeld(m.userId)
      if (held && (await this.answerHeld(m, held, text, reply))) return
      const wizard = this.wizards.get(m.userId)
      if (!wizard && (await this.deps.policies.get(m.userId)) === null)
        return await this.firstContact(m.userId, text, reply)
      if (KILL.test(text)) return await this.kill(m.userId, reply)
      if (wizard) return await this.wizard(m.userId, wizard, text, reply)
      if (YES.test(text) || NO.test(text)) {
        const ctx = await this.ctxFor(m.userId)
        const latest = await ctx.pending.latest(m.userId)
        if (latest) return await this.decide(m.userId, latest.actionHash, YES.test(text), reply)
        // a bare "stop" with nothing to cancel means stop everything
        if (STOP.test(text)) return await this.kill(m.userId, reply)
      }
      const history = await this.deps.history.get(m.userId)
      const result = await runTurn(
        { ...this.deps.agent, resolveContext: (u) => this.ctxFor(u) },
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
      await this.deps.afterSpend?.(m.userId)
    } catch (err) {
      console.error("[dispatcher]", err instanceof Error ? err.message : err)
      await reply("Something went wrong on my side. Nothing was sent. Try again in a moment.")
    }
  }

  /** Stop everything: the kill switch on, the wizard dropped, nothing left waiting for a yes. */
  private async kill(userId: string, reply: (t: string) => Promise<void>): Promise<void> {
    this.wizards.delete(userId)
    const ctx = await this.deps.resolveContext(userId)
    await this.deps.policies.set(userId, { ...ctx.policy, killSwitch: true })
    for (let i = 0; i < 20; i++) {
      const p = await ctx.pending.latest(userId)
      if (!p) break
      await ctx.pending.delete(userId, p.actionHash)
    }
    return reply("Stopped. Nothing moves until you say “resume”.")
  }

  /**
   * A message that looks like a secret never reaches the model. A wallet connection string pairs;
   * a key is stored under the name the message gives ("my strike key is …"), the one the user just
   * asked to connect, or the answer to one question. The message is redacted first, whatever follows.
   */
  private async secret(
    m: InboundMessage,
    text: string,
    reply: (t: string) => Promise<void>,
  ): Promise<void> {
    await this.redact(m)
    const nwc = NWC_RE.exec(text)?.[0]
    if (nwc) return this.pair(m, [nwc], reply)
    const key = keyToken(text)
    if (!key)
      return reply(
        "That looks like a secret, so I removed it and did not read it. To connect a wallet, paste its connection string as a message of its own; for Strike or Bitrefill, paste the key on its own.",
      )
    const named = /\bstrike\b/i.test(text)
      ? "strike"
      : /\bbitrefill\b/i.test(text)
        ? "bitrefill"
        : null
    const armed = this.expecting.get(m.userId)
    const expected = armed && this.now().getTime() - armed.at < EXPECT_MS ? armed.name : null
    this.expecting.delete(m.userId)
    const name = named ?? expected
    if (name) return this.storeKey(m.userId, name, key, reply)
    if (!this.deps.secretsKey)
      return reply("Key storage is disabled on this server (no SECRETS_KEY).")
    this.held.set(m.userId, { kind: "key", value: key, at: this.now().getTime() })
    return reply(
      "That looks like an API key, so I removed the message and did not show it to the model. Is it a Strike key or a Bitrefill key? Reply “strike” or “bitrefill”. Anything else and I forget it.",
    )
  }

  /** A held secret is good for one answer within a few minutes; it is gone as soon as it is read. */
  private takeHeld(userId: string): Held | null {
    const h = this.held.get(userId)
    if (!h) return null
    this.held.delete(userId)
    return this.now().getTime() - h.at < HELD_MS ? h : null
  }

  /** True when the message answered the question about a held secret. */
  private async answerHeld(
    m: InboundMessage,
    held: Held,
    text: string,
    reply: (t: string) => Promise<void>,
  ): Promise<boolean> {
    const t = text.toLowerCase().replace(/[.!]+$/, "")
    if (held.kind === "key" && (t === "strike" || t === "bitrefill")) {
      await this.storeKey(m.userId, t, held.value, reply)
      return true
    }
    if (held.kind === "nwc-unbudgeted" && t === "connect anyway") {
      await this.pair(m, ["unbudgeted", held.value], reply)
      return true
    }
    return false
  }

  private async storeKey(
    userId: string,
    name: "strike" | "bitrefill",
    value: string,
    reply: (t: string) => Promise<void>,
  ): Promise<void> {
    if (!this.deps.secretsKey)
      return reply("Key storage is disabled on this server (no SECRETS_KEY).")
    await this.deps.secrets.set(userId, name, encryptSecret(value, this.deps.secretsKey))
    this.deps.onCredentialsChanged?.(userId)
    const rail = name === "strike" ? "exchange" : "goods"
    const on = ((await this.deps.policies.get(userId)) ?? DEFAULT_POLICY).rails[rail]
    return reply(
      `${name === "strike" ? "Strike" : "Bitrefill"} key stored (${maskSecret(value)}). I deleted your message if I could; delete it yourself otherwise.${on ? "" : `\n${RAIL_LABEL[rail]} is switched off in your limits. Say “turn on ${RAIL_LABEL[rail].toLowerCase()}” when you want it.`}`,
    )
  }

  /** A number we have never seen: gate on the invite code if configured, then greet and start the limits wizard. */
  private async firstContact(
    userId: string,
    text: string,
    reply: (t: string) => Promise<void>,
  ): Promise<void> {
    const code = this.deps.inviteCode?.trim()
    // M22: a friend's invite code counts as an invitation and links the two (one referral, before any payment).
    const joined = await this.joinAtFirstContact(userId, text)
    if (code && !joined && text.trim().toLowerCase() !== code.toLowerCase()) {
      return reply(
        "Hey! Glad you're here. Agentic Bitcoin is working with a small group right now while we ramp up. If someone gave you an invite code, send it here and you're in. Otherwise you're on the list and I'll message you the moment a spot opens. Nothing else you need to do.",
      )
    }
    const w = startWizard()
    this.wizards.set(userId, w.state)
    return reply(
      `Hey! Glad you're here. I'm Agentic Bitcoin: text me in plain words and I'll move bitcoin through your own wallet, within limits you set. Nothing moves without your limits, and anything over your threshold waits for your yes.${joined ? `\n\n${joined}` : ""}\n\n${w.prompt}`,
    )
  }

  /** A slash alias for a settings change: the human typed it, so it applies at once. */
  private async apply(
    userId: string,
    c: SettingChange,
    reply: (t: string) => Promise<void>,
  ): Promise<void> {
    const p = await planSetting(this.deskDeps, userId, c)
    return reply(p.ok ? await p.commit() : p.error)
  }

  private referralsOn(): boolean {
    return !!this.deps.referrals && referralsEnabled(this.deps.referrals.rules)
  }

  /** A first message that is a friend's code: record the referral and say what it earns. Null when it is not one. */
  private async joinAtFirstContact(userId: string, text: string): Promise<string | null> {
    const rc = this.deps.referrals
    if (!rc || !this.referralsOn()) return null
    const code = normalizeCode(text)
    if (!code) return null
    const r = await joinWithCode(rc.store, rc.rules, {
      code,
      friendId: userId,
      spent: false,
      now: this.now(),
      newId: rc.newId,
    })
    if (!r.ok)
      return r.code === "SELF" ? "That is your own invite code, so it does not count." : null
    return `Your friend's code is in: ${this.joinTerms()}`
  }

  private joinTerms(): string {
    const rules = this.deps.referrals?.rules
    return rules ? joinTerms(rules) : ""
  }

  /** /refer: the user's code, link and tally. */
  private async refer(userId: string, reply: (t: string) => Promise<void>): Promise<void> {
    const rc = this.deps.referrals
    const rewards = this.deps.rewardStore
    if (!rc || !rewards || !this.referralsOn())
      return reply("Referral rewards are not on for this server.")
    const st = await referralStats(rc.store, rewards, rc.rules, userId, this.deps.siteUrl)
    const earn = [
      rc.rules.referrerSats > 0n ? `you get ${formatSats(rc.rules.referrerSats)}` : "",
      rc.rules.friendSats > 0n ? `they get ${formatSats(rc.rules.friendSats)}` : "",
    ]
      .filter(Boolean)
      .join(" and ")
    const tally = st.joined
      ? `\nSo far: ${st.joined} joined · ${st.qualified} qualified · ${formatSats(st.earnedSats)} earned.`
      : ""
    return reply(
      `Your invite code is ${st.code}. Share ${st.link} or tell a friend to text me the code first.\nWhen a friend joins with it and makes a first payment of at least ${formatSats(rc.rules.qualifyingSats)}, ${earn}, paid to your own wallets (up to ${rc.rules.maxPerReferrerPerMonth} friends a month).${tally}\nRewards are a promise from this server's operator, not a balance; ask me about your rewards to see what is pending and paid.`,
    )
  }

  /** /web: a link that opens the workspace; /web revoke cuts off every link. */
  private async web(
    userId: string,
    args: string[],
    reply: (t: string) => Promise<void>,
  ): Promise<void> {
    const wl = this.deps.webLinks
    if (!wl || !this.deps.siteUrl) return reply("The web workspace is not on for this server.")
    if (args[0]?.toLowerCase() === "revoke")
      return this.apply(userId, setting("workspace_links", "revoke"), reply)
    const now = this.now()
    const token = wl.newToken()
    const ttl = wl.ttlDays ?? 30
    await wl.store.create({
      tokenHash: hashWebToken(token),
      userId,
      createdAt: now.toISOString(),
      expiresAt: webLinkExpiry(now, ttl),
    })
    return reply(
      `Your Anvard on the web: ${workspaceUrl(this.deps.siteUrl, token)}\nIt opens your limits, wallet, cards, address, invites and rewards for ${ttl} days from any browser. Keep it private: anyone with the link sees what you see. Ask me for a fresh one any time, or say “log me out of the web everywhere”.`,
    )
  }

  private async redact(m: InboundMessage): Promise<void> {
    if (!m.messageId || !this.deps.surface.redact || this.redacted.has(m)) return
    this.redacted.add(m)
    await this.deps.surface.redact(m.userId, m.messageId)
  }

  private async decide(
    userId: string,
    actionHash: string,
    approve: boolean,
    reply: (t: string) => Promise<void>,
  ): Promise<void> {
    const ctx = await this.ctxFor(userId)
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
    if (parsed.status === "succeeded" && out.userText) {
      await reply(`Done. ${out.userText}`)
      return
    }
    if (parsed.status === "succeeded") {
      await reply(
        `Done. ${parsed.summary ?? ""}${parsed.result?.preimage ? ` Preimage ${parsed.result.preimage}` : ""}`.trim(),
      )
      if (out.deliverToUser) await reply(out.deliverToUser)
      await this.deps.afterSpend?.(userId)
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
      case "/unpair":
        return this.apply(userId, setting("wallet", "disconnect"), reply)
      case "/key":
        return this.key(m, args, reply)
      case "/cold":
        return this.cold(userId, args, ctx.policy, reply)
      case "/kill":
        return this.kill(userId, reply)
      case "/resume":
        return this.apply(userId, setting("kill_switch", "off"), reply)
      case "/budget": {
        if (args.length === 0) return reply(describePolicy(ctx.policy))
        const c = budgetChange(args)
        if (!c)
          return reply(
            "Tell me the change in plain words: “set my daily cap to 50,000 sats”, “ask me above 5,000”, “block *.evil.example”, “turn on buying bitcoin”.",
          )
        return this.apply(userId, c, reply)
      }
      case "/recipients":
        return this.recipients(userId, reply)
      case "/recipient":
        return this.recipient(userId, args, reply)
      case "/statement":
        return this.statement(userId, ctx, args, reply)
      case "/verify":
        return this.verify(userId, args, reply)
      case "/campaigns":
        return this.campaigns(userId, reply)
      case "/address":
        return this.address(userId, args, reply)
      case "/cards":
        return this.cards(userId, args, reply)
      case "/bills":
        return this.bills(userId, ctx, args, reply)
      case "/refer":
      case "/invite":
        return this.refer(userId, reply)
      case "/join":
        return this.apply(userId, setting("referral_code", "join", args.join(" ")), reply)
      case "/web":
      case "/account":
        return this.web(userId, args, reply)
      case "/note":
        return this.note(ctx, args, reply)
      case "/notes":
        return this.notes(ctx, reply)
      case "/replace": {
        if (!args.length) {
          const r = applyReplaceArgs(ctx.policy, [], this.now(), !!ctx.rails.exchange)
          return reply(r.ok ? r.text : r.error)
        }
        return this.apply(
          userId,
          setting("replace", (args[0] ?? "").toLowerCase(), args[1] ?? ""),
          reply,
        )
      }
      case "/invoices": {
        const store = this.deps.invoiceStore
        if (!store) return reply("Invoices are not enabled on this server.")
        const list = await store.listForIssuer(userId, 100)
        if (args[0]?.toLowerCase() === "csv") return reply(invoicesCsv(list, this.now()))
        const now = this.now()
        const open = list.filter((i) => i.state === "open")
        if (!list.length)
          return reply(
            "No invoices yet. Say e.g. “invoice Bob $200 for the deck due friday” or “request $18 from Alice for dinner”.",
          )
        const line = (i: IssuedInvoice) =>
          `• ${i.number} ${i.payerName} ${formatCents(i.totalCents)} — ${invoiceStatus(i, now)}${i.dueAt ? ` · due ${i.dueAt.slice(0, 10)}` : ""} · ${this.deps.siteUrl ?? ""}/pay/${i.token}`
        return reply(
          `${open.length} open of ${list.length}.\n${list.slice(0, 10).map(line).join("\n")}${list.length > 10 ? "\n…" : ""}\nSay “export my invoices” for the full list as CSV, or “void inv_…” to cancel one.`,
        )
      }
      case "/rewards": {
        const store = this.deps.rewardStore
        if (!store) return reply("Rewards are not enabled on this server.")
        const list = await store.listForUser(userId)
        const sum = summarizeRewards(list, this.now())
        if (!sum.count)
          return reply(
            `No rewards yet. Store purchases earn sats-back once they are paid; ask me to find something in the shop.${this.referralsOn() ? " Ask me how to invite a friend and you both earn sats." : ""}`,
          )
        return reply(
          `Sats-back: ${formatSats(sum.paidSats)} paid · ${formatSats(sum.payableSats)} payable now · ${formatSats(sum.pendingSats)} pending${sum.nextPayableAt ? ` (next on ${sum.nextPayableAt.slice(0, 10)})` : ""}.\nPayouts arrive in your paired wallet automatically; until paid, a reward is a promise from us, not a balance. ${this.deps.siteUrl ?? ""}/rewards`,
        )
      }
      case "/shop":
        return reply(
          `Browse the store: ${this.deps.siteUrl ?? ""}/shop — every price in sats, every invoice from the merchant's own wallet. Or just tell me: “find me a study bible”, then “buy <id>”. Physical goods: add “ship to name, street, city, region, postal, country”.`,
        )
      case "/orders": {
        const store = this.deps.orders
        if (!store || !this.deps.buyerKeyOf)
          return reply("The store is not enabled on this server.")
        const list = await store.listForBuyer(this.deps.buyerKeyOf(userId), 10)
        if (!list.length)
          return reply(
            "No orders yet. Tell me what you are looking for and I will search the shop.",
          )
        return reply(
          list
            .map(
              (o) =>
                `• ${o.createdAt.slice(0, 10)} ${o.state.padEnd(9)} ${o.items.map((i) => `${i.qty}× ${i.title}`).join(", ")} · ${formatCents(o.totalCents)} (${formatSats(o.totalSats)}) from ${o.merchantSlug}${o.note ? ` — ${o.note}` : ""}\n  ${this.deps.siteUrl ?? ""}/shop/orders/${o.id}`,
            )
            .join("\n"),
        )
      }
      case "/follow":
      case "/unfollow":
        return this.apply(
          userId,
          setting("campaign_updates", (cmd ?? "").slice(1).toLowerCase(), args[0] ?? ""),
          reply,
        )
      case "/receive":
        return reply(
          `Churches, missionaries and creators receive through their own wallet, never ours. Onboard at ${this.deps.siteUrl ?? "the website"}/receive — a Lightning address you already have, or a receive-only wallet connection. You get a give page, a tip page and a Lightning address; the operator verifies you before you appear in the directory.`,
        )
      case "/ledger": {
        const entries = await readEntries(ctx.ledger)
        const price = await this.deps.agent.price()
        const spent = spentSince(entries, windowStart(this.now()))
        const lines = entries
          // a note shows on the payment it belongs to; looking at a view is not activity
          .filter((e) => e.action.kind !== "add_note" && e.action.kind !== "show")
          .slice(-8)
          .reverse()
          .map((e) => {
            const note = this.openNote(e)
            return `${e.at.slice(5, 16).replace("T", " ")} ${e.outcome.padEnd(9)} ${e.decision.summary}${note ? ` — “${note}”` : ""}`
          })
        const fiat = price ? ` (≈ ${formatCents(satsToCents(spent, price))})` : ""
        return reply(
          `Last 24h: ${formatSats(spent)}${fiat} of ${formatSats(ctx.policy.dailyCapSats)}.\n${lines.join("\n") || "No actions yet."}`,
        )
      }
      default:
        // a secret after an unknown slash still must not linger in the chat
        if (looksLikeSecret(text)) return this.secret(m, text, reply)
        return reply(`I did not recognise that. ${HELP}`)
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
      return reply(
        "Connecting a wallet is disabled on this server (no SECRETS_KEY). Ask the operator.",
      )
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
    if (!verdict.ok) {
      // hold the string for one answer so "connect anyway" needs no second paste
      if (verdict.unbudgeted)
        this.held.set(m.userId, { kind: "nwc-unbudgeted", value: url, at: this.now().getTime() })
      return reply(verdict.error)
    }
    await this.deps.secrets.set(m.userId, "nwc", encryptSecret(url, this.deps.secretsKey))
    this.deps.onCredentialsChanged?.(m.userId)
    return reply(
      `${verdict.description}\nI have deleted your message if I could; delete it yourself otherwise. Try: what's my balance?`,
    )
  }

  private async recipients(userId: string, reply: (t: string) => Promise<void>): Promise<void> {
    const store = this.deps.recipients
    if (!store) return reply("Giving is not enabled on this server.")
    const all = await store.list(userId)
    const visible = all.filter((r) => isTrustedRecipient(r, userId))
    if (!visible.length)
      return reply(
        "No recipients yet. Add your own by telling me, e.g. “add give@mychurch.org as My Church”.",
      )
    const line = (r: Recipient) =>
      `• ${r.name} — ${r.slug} (${r.kind}${r.ownerUserId ? ", yours" : r.verified ? `, verified by ${r.verified.how}` : ""})${r.website ? ` ${r.website}` : ""}`
    return reply(
      `You can give to:\n${visible.map(line).join("\n")}\nSay e.g. “give 1000 sats to ${visible[0]?.slug}” or “tithe 20000 sats to ${visible[0]?.slug} every sunday”. To add your own: “add give@mychurch.org as My Church”.`,
    )
  }

  /** `/recipient add <lightning address> <name…>` (private to this user) · `/recipient remove <slug>`. */
  private async recipient(
    userId: string,
    args: string[],
    reply: (t: string) => Promise<void>,
  ): Promise<void> {
    const [sub, ...rest] = args
    if (sub?.toLowerCase() === "remove")
      return this.apply(userId, setting("recipient", "remove", rest[0] ?? ""), reply)
    if (sub?.toLowerCase() !== "add" || rest.length < 2)
      return reply(
        "Tell me in plain words: “add give@mychurch.org as My Church”, or “remove my-church”.",
      )
    return this.apply(
      userId,
      setting("recipient", "add", rest[0] ?? "", rest.slice(1).join(" ")),
      reply,
    )
  }

  private async campaigns(userId: string, reply: (t: string) => Promise<void>): Promise<void> {
    const store = this.deps.campaigns
    if (!store) return reply("Campaigns are not enabled on this server.")
    const price = await this.deps.agent.price()
    const active = await store.listActive()
    if (!active.length)
      return reply("No campaigns yet. Recipients create them from their dashboard on the website.")
    const mine = new Set(await store.following(userId))
    const lines: string[] = []
    for (const c of active) {
      const p = campaignProgress(
        c,
        await store.contributions(c.slug),
        await store.pledges(c.slug),
        {
          satsPerUsdCent: price ? (cents) => centsToSats(cents, price) : undefined,
        },
      )
      lines.push(
        `• ${c.title} — ${c.slug} (for ${c.recipientSlug}): goal ${p.goalLabel}${p.percent !== null ? `, ${p.percent}%` : ""} · ${formatSats(p.raisedSats)} raised · ${p.supporters} supporter${p.supporters === 1 ? "" : "s"}${p.pledges ? ` · ${p.pledges} pledge${p.pledges === 1 ? "" : "s"}` : ""}${mine.has(c.slug) ? " · following" : ""}`,
      )
    }
    return reply(
      `${lines.join("\n")}\nSay e.g. “support ${active[0]?.recipientSlug} $25 a month” or “give 5000 sats to ${active[0]?.recipientSlug}”. Say “follow ${active[0]?.slug}” for its updates.`,
    )
  }

  /** Operator only: mark a directory recipient as verified ("operator" = we vouched in person). */
  private async verify(
    userId: string,
    args: string[],
    reply: (t: string) => Promise<void>,
  ): Promise<void> {
    const store = this.deps.recipients
    if (!store) return reply("Giving is not enabled on this server.")
    if (!this.deps.operators?.includes(userId))
      return reply("Only the operator can verify recipients.")
    const slug = args[0]?.toLowerCase()
    if (!slug) {
      const pending = (await store.list()).filter((r) => !r.ownerUserId && !r.verified)
      return reply(
        pending.length
          ? `Pending verification:\n${pending.map((r) => `• ${r.name} — ${r.slug} · ${r.lightningAddress}${r.website ? ` · ${r.website}` : ""}`).join("\n")}\nVerify one with /verify <slug> after confirming the address with them directly. /verify revoke <slug> removes verification.`
          : "Nothing pending verification.",
      )
    }
    if (slug === "revoke") {
      const target = args[1]?.toLowerCase()
      const r = target ? await store.get(target) : null
      if (!r || r.ownerUserId) return reply("No such directory recipient.")
      await store.upsert({ ...r, verified: null })
      return reply(
        `${r.name} is no longer verified; gifts to it are denied and recurring gifts will be refused at their next run.`,
      )
    }
    const r = await store.get(slug)
    if (!r || r.ownerUserId)
      return reply("No such directory recipient. /verify lists the pending ones.")
    if (r.verified) return reply(`${r.name} is already verified (${r.verified.how}).`)
    await store.upsert({ ...r, verified: { how: "operator", at: this.now().toISOString() } })
    return reply(`Verified ${r.name} (${r.slug}). It is now listed and can receive gifts.`)
  }

  /**
   * `/address <name>` claims name@<host> pointing at the user's own paired wallet; `/address forward <ln address>`
   * forwards instead; `/address` shows it; `/address remove` drops it.
   */
  private async address(
    userId: string,
    args: string[],
    reply: (t: string) => Promise<void>,
  ): Promise<void> {
    const store = this.deps.addresses
    const host = this.deps.siteUrl ? new URL(this.deps.siteUrl).host : "anvard.ai"
    if (!store) return reply("Lightning addresses are not enabled on this server.")
    const current = await store.getForUser(userId)
    const [sub, ...rest] = args
    if (!sub) {
      return reply(
        current
          ? `Your Lightning address is ${current.name}@${host}${current.forwardTo ? ` (forwards to ${current.forwardTo})` : " (invoices are created by your own wallet)"}. Share it anywhere; the sats land in your wallet. Say “give up my address” to drop it.`
          : `No address yet. Tell me the name you want: “I want the address graham” gives you graham@${host}, paying straight into your own wallet.`,
      )
    }
    const op = sub.toLowerCase()
    if (op === "remove") return this.apply(userId, setting("lightning_address", "remove"), reply)
    if (op === "forward")
      return this.apply(userId, setting("lightning_address", "forward", rest[0] ?? ""), reply)
    return this.apply(userId, setting("lightning_address", "claim", sub), reply)
  }

  /**
   * `/cards` lists the user's virtual cards with this month's spend; `/cards pause|resume|close <id>`
   * changes one (resume asks the agent path for a yes — here it is the user typing, so it applies).
   */
  private async cards(
    userId: string,
    args: string[],
    reply: (t: string) => Promise<void>,
  ): Promise<void> {
    const store = this.deps.cards
    if (!store) return reply("Virtual cards are not enabled on this server.")
    const ctx = await this.deps.resolveContext(userId)
    const now = this.now()
    const [sub, id, token] = args
    if (sub?.toLowerCase() === "claim") {
      // A card made on the web (/shop/cards) is owned by nobody until the person who holds its
      // link claims it from the chat they pay from; from then on it budgets their spends.
      if (!id || !token) return reply("Usage: /cards claim <id> <token> (from the card's link).")
      const hash = createHash("sha256").update(token).digest("hex")
      const r = await claimCard(store, id, hash, userId)
      if (r.ok)
        return reply(
          `Card “${r.card.name}” is yours: ${formatSats(r.card.monthlyCapSats)} a month for ${r.card.scope.join(", ")}. Matching payments count against it from now on.${this.deps.siteUrl ? ` ${this.deps.siteUrl}/card/${r.card.id}` : ""}`,
        )
      const why = {
        NOT_FOUND: `No card ${id}.`,
        NOT_AUTHORIZED: "That token does not match this card.",
        ALREADY_CLAIMED: "That card already belongs to someone.",
        LIMIT: "You already have the maximum number of cards; close one first.",
        NAME: "You already have a card with that name; close or rename it first.",
      }[r.code]
      return reply(why)
    }
    if (sub && id) {
      const op = sub.toLowerCase()
      if (!["pause", "resume", "close"].includes(op))
        return reply(
          "Usage: /cards · /cards pause <id> · /cards resume <id> · /cards close <id> · /cards claim <id> <token>",
        )
      const c = await store.get(id)
      if (!c || c.userId !== userId) return reply(`No card ${id}.`)
      await store.update({
        ...c,
        state: op === "pause" ? "paused" : op === "close" ? "closed" : "active",
      })
      return reply(
        `Card “${c.name}” is now ${op === "pause" ? "paused" : op === "close" ? "closed" : "active"}.`,
      )
    }
    const entries = await readEntries(ctx.ledger)
    const cards = (await store.listForUser(userId)).filter((c) => c.state !== "closed")
    if (!cards.length)
      return reply(
        "No virtual cards. Say e.g. “create a virtual card for steam with a 50,000 sat monthly limit”. A card is a monthly budget on your own wallet for one kind of spend; nothing moves into it.",
      )
    const line = (c: VirtualCard) => {
      const spent = cardSpentSince(entries, c.id, periodStart(c, now))
      return `• ${c.name} (${c.id}) — ${c.state} · ${formatSats(spent)} of ${formatSats(c.monthlyCapSats)} this month · pays ${c.scope.join(", ")} · resets ${periodEnd(c, now).slice(0, 10)}${this.deps.siteUrl ? ` · ${this.deps.siteUrl}/card/${c.id}` : ""}`
    }
    return reply(
      `${cards.map(line).join("\n")}\nSay “pause my ${cards[0]?.name ?? "card"} card” to freeze one instantly.`,
    )
  }

  /** M20: `/bills` lists the user's bills (schedules of kind bill); `/bills cancel <id>` stops one. */
  private async bills(
    userId: string,
    ctx: UserContext,
    args: string[],
    reply: (t: string) => Promise<void>,
  ): Promise<void> {
    const hook = ctx.schedules
    if (!hook?.list) return reply("Bills are not enabled on this server.")
    const [sub, id] = args
    if (sub?.toLowerCase() === "cancel") {
      if (!id) return reply("Usage: /bills cancel <id>")
      try {
        await hook.cancel(id)
        return reply(`Stopped ${id}. Nothing already paid changes.`)
      } catch (err) {
        return reply(`Could not stop ${id}: ${(err as Error).message}.`)
      }
    }
    const bills = (await hook.list()).filter((x) => x.kind === "bill" && x.active)
    if (!bills.length)
      return reply(
        "No bills yet. Say e.g. “pay my rent, $450 to landlord@example.com on the 1st” or add “ask me first” to approve each one. A bill pays from your own wallet within your limits; dollar amounts are priced on the day.",
      )
    const now = this.now()
    const line = (b: (typeof bills)[number]) => {
      let next = ""
      try {
        const n = nextRun(parseCron(b.cron), now)
        if (n) next = ` · next ${n.toISOString().slice(0, 10)}`
      } catch {
        /* unparsable cron: the runner cancels it */
      }
      return `• ${b.summary} (${b.id})${next}`
    }
    return reply(`${bills.map(line).join("\n")}\nSay “stop paying <name>” to stop one.`)
  }

  /** M21: the user's private note on an entry, opened with SECRETS_KEY when it was sealed. */
  private openNote(e: LedgerEntry): string | undefined {
    if (e.note) return e.note
    if (!e.noteSealed) return undefined
    if (!this.deps.secretsKey) return "(sealed note; this server has no key)"
    try {
      return decryptSecret(e.noteSealed, this.deps.secretsKey)
    } catch {
      return "(sealed note; wrong key)"
    }
  }

  /**
   * `/note <text>` puts a private note on the last payment; `/note <id> <text>` on that entry;
   * `/note clear [id]` removes one. It is the add_note action, so it is ledgered like everything else.
   */
  private async note(
    ctx: UserContext,
    args: string[],
    reply: (t: string) => Promise<void>,
  ): Promise<void> {
    if (!args.length)
      return reply(
        "Say “add a note to my last payment: plumber deposit”, or put it on the payment itself: “pay 500 sats to x@y, note: plumber deposit”. Notes stay in your own ledger; the payee never sees them.",
      )
    let rest = [...args]
    const clear = rest[0]?.toLowerCase() === "clear"
    if (clear) rest = rest.slice(1)
    const entryId = /^act_[0-9a-z_]+$/i.test(rest[0] ?? "") ? (rest.shift() as string) : ""
    const text = clear ? "" : rest.join(" ").trim()
    if (!clear && !text) return reply("What should the note say?")
    const now = this.now()
    const out = await handleToolCall(
      ctx,
      "add_note",
      { text, entry_id: entryId, match: "" },
      {
        callId: `note:${now.getTime().toString(36)}`,
        price: await this.deps.agent.price(),
        now: () => now,
      },
    )
    const r = JSON.parse(out.content) as {
      status: string
      error?: string
      result?: { entryId: string; summary: string; cleared: boolean }
    }
    if (r.status !== "succeeded" || !r.result)
      return reply(
        entryId
          ? `No payment ${entryId} in your ledger.`
          : "No payment to note yet. Notes attach to payments; ask me for your activity to see them.",
      )
    return reply(
      r.result.cleared
        ? `Note removed from “${r.result.summary}” (${r.result.entryId}).`
        : `Noted privately on “${r.result.summary}” (${r.result.entryId}). The payee never sees it; ask me for your notes to list them.`,
    )
  }

  /** `/notes`: the payments that carry a private note, newest first. */
  private async notes(ctx: UserContext, reply: (t: string) => Promise<void>): Promise<void> {
    const noted = paymentEntries(await readEntries(ctx.ledger))
      .map((e) => ({ e, note: this.openNote(e) }))
      .filter((x): x is { e: LedgerEntry; note: string } => !!x.note)
      .slice(-10)
      .reverse()
    if (!noted.length)
      return reply(
        "No private notes yet. Say “pay 500 sats to x@y, note: plumber deposit”, or “add a note to my last payment: …”. Notes stay in your own ledger; the payee never sees them.",
      )
    return reply(
      noted
        .map(
          ({ e, note }) =>
            `${e.at.slice(5, 16).replace("T", " ")} ${e.decision.summary} — “${note}” (${e.id})`,
        )
        .join("\n"),
    )
  }

  /** `/statement [year]`: the year's succeeded gifts as CSV. We are not the donee; the recipient issues receipts. */
  private async statement(
    userId: string,
    ctx: UserContext,
    args: string[],
    reply: (t: string) => Promise<void>,
  ): Promise<void> {
    const year = /^\d{4}$/.test(args[0] ?? "") ? Number(args[0]) : this.now().getUTCFullYear()
    const rows = givingRows(await readEntries(ctx.ledger), year)
    if (!rows.length) return reply(`No gifts recorded in ${year}.`)
    const total = rows.reduce((a, r) => a + r.sats, 0n)
    const usd = rows.reduce((a, r) => a + (r.usdCents ?? 0n), 0n)
    void userId
    return reply(
      `Giving statement ${year}: ${rows.length} gift${rows.length === 1 ? "" : "s"}, ${formatSats(total)}${usd > 0n ? ` (≈ ${formatCents(usd)} at the time of each gift)` : ""}.\nThis is your record, not a receipt: ask each recipient for one.\n\n${givingStatementCsv(rows)}`,
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
          ? `Cold storage: ${current.join(", ")}\nAsk me to “sweep everything above 200000 sats to cold storage” or “sweep monthly”. To drop one, say “remove my cold storage address”.`
          : "No cold-storage address yet. Tell me one from your hardware wallet: “my cold storage address is bc1…”. Sweeps can only go to addresses you register.",
      )
    }
    if (addr.toLowerCase() === "remove")
      return this.apply(userId, setting("cold_storage", "remove", args[1] ?? ""), reply)
    return this.apply(userId, setting("cold_storage", "add", addr), reply)
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
      lines.push(`wallet: ${nwc ? "connected" : "not connected (say “connect my wallet”)"}`)
      return reply(`${lines.join("\n")}\n\n${KEY_HELP}`)
    }
    await this.redact(m)
    if (cmd.kind === "remove")
      return this.apply(m.userId, setting("key", "remove", cmd.name), reply)
    return this.storeKey(m.userId, cmd.name, cmd.value, reply)
  }
}

const setting = (
  s: SettingChange["setting"],
  op: string,
  value = "",
  name = "",
): SettingChange => ({ setting: s, op, value, name })

/** The key-shaped token in a message that tripped `looksLikeSecret`, or null when there is not exactly one. */
function keyToken(text: string): string | null {
  const tokens = text.match(/[A-Za-z0-9_-]{20,}/g) ?? []
  return tokens.length === 1 ? (tokens[0] as string) : null
}

/** Three sentences. Everything else is a conversation. */
export const HELP =
  "Text me in plain words. Try “what's my balance?”, “pay 500 sats to gm@getalby.com” or “set my daily cap to 20,000 sats”. Say “stop everything” at any time and nothing moves until you say “resume”."

export { DEFAULT_POLICY }
export { applyReplaceArgs, budgetChange, describePolicy, describeReplace } from "./desk"
