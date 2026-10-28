import { createHash } from "node:crypto"
/**
 * The dispatcher: turns inbound chat messages into agent turns, commands, confirmation decisions,
 * or onboarding steps. Surface-agnostic. Commands never go through the model (they change policy
 * and credentials, which the model is not allowed to touch — ADR-0008). Secrets never reach the
 * model or the history: a message that looks like one is intercepted before `runTurn`.
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
  type InvoiceStore,
  type IssuedInvoice,
  type LedgerEntry,
  type LightningAddressStore,
  type OrderStore,
  type Policy,
  type Recipient,
  type RecipientStore,
  type RewardStore,
  SLUG_RE,
  type VirtualCard,
  campaignProgress,
  cardSpentSince,
  centsToSats,
  claimCard,
  formatCents,
  formatSats,
  givingRows,
  givingStatementCsv,
  invoiceStatus,
  invoicesCsv,
  isLightningAddress,
  isTrustedRecipient,
  normalizeAddressName,
  parseAddress,
  paymentEntries,
  periodEnd,
  periodStart,
  readEntries,
  replaceSetting,
  satsToCents,
  slugify,
  spentSince,
  summarizeRewards,
  windowStart,
} from "@agentic-bitcoin/core"
import {
  decryptSecret,
  encryptSecret,
  maskSecret,
  validateConnectionString,
} from "@agentic-bitcoin/rails"
import { nextRun, parseCron } from "@agentic-bitcoin/scheduler"
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
      await this.deps.afterSpend?.(m.userId)
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
      case "/note":
        return this.note(ctx, args, reply)
      case "/notes":
        return this.notes(ctx, reply)
      case "/replace": {
        const r = applyReplaceArgs(ctx.policy, args, this.now(), !!ctx.rails.exchange)
        if (!r.ok) return reply(r.error)
        if (r.policy !== ctx.policy) await this.deps.policies.set(userId, r.policy)
        return reply(r.text)
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
          `${open.length} open of ${list.length}.\n${list.slice(0, 10).map(line).join("\n")}${list.length > 10 ? "\n…" : ""}\n/invoices csv for the full list. Say “void inv_…” to cancel one.`,
        )
      }
      case "/rewards": {
        const store = this.deps.rewardStore
        if (!store) return reply("Rewards are not enabled on this server.")
        const list = await store.listForUser(userId)
        const sum = summarizeRewards(list, this.now())
        if (!sum.count)
          return reply(
            "No sats-back yet. Store purchases earn rewards once they are paid; /shop to browse.",
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
        if (!list.length) return reply("No orders yet. /shop to browse.")
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
      case "/unfollow": {
        const store = this.deps.campaigns
        if (!store) return reply("Campaigns are not enabled on this server.")
        const slug = args[0]?.toLowerCase()
        const c = slug ? await store.get(slug) : null
        if (!c) return reply("Which campaign? /campaigns lists them.")
        if (cmd === "/follow") {
          await store.follow(c.slug, userId)
          return reply(
            `Following ${c.title}: I will send you its updates here. /unfollow ${c.slug} to stop.`,
          )
        }
        await store.unfollow(c.slug, userId)
        return reply(`No more updates from ${c.title}.`)
      }
      case "/receive":
        return reply(
          `Churches, missionaries and creators receive through their own wallet, never ours. Onboard at ${this.deps.siteUrl ?? "the website"}/receive — a Lightning address you already have, or a receive-only wallet connection. You get a give page, a tip page and a Lightning address; the operator verifies you before you appear in the directory.`,
        )
      case "/ledger": {
        const entries = await readEntries(ctx.ledger)
        const price = await this.deps.agent.price()
        const spent = spentSince(entries, windowStart(this.now()))
        const lines = entries
          .filter((e) => e.action.kind !== "add_note") // the note shows on the payment it belongs to
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
        if (looksLikeSecret(text)) {
          await this.redact(m)
          return reply(
            "That looks like a wallet connection string or an API key. I never pass those to the model. Use /pair <string> or /key <strike|bitrefill> <key> instead, and delete that message.",
          )
        }
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

  private async recipients(userId: string, reply: (t: string) => Promise<void>): Promise<void> {
    const store = this.deps.recipients
    if (!store) return reply("Giving is not enabled on this server.")
    const all = await store.list(userId)
    const visible = all.filter((r) => isTrustedRecipient(r, userId))
    if (!visible.length)
      return reply(
        "No recipients yet. Add your own: /recipient add <lightning address> <name>, e.g. /recipient add give@mychurch.org My Church",
      )
    const line = (r: Recipient) =>
      `• ${r.name} — ${r.slug} (${r.kind}${r.ownerUserId ? ", yours" : r.verified ? `, verified by ${r.verified.how}` : ""})${r.website ? ` ${r.website}` : ""}`
    return reply(
      `You can give to:\n${visible.map(line).join("\n")}\nSay e.g. “give 1000 sats to ${visible[0]?.slug}” or “tithe 20000 sats to ${visible[0]?.slug} every sunday”. /recipient add|remove manages your own.`,
    )
  }

  /** `/recipient add <lightning address> <name…>` (private to this user) · `/recipient remove <slug>`. */
  private async recipient(
    userId: string,
    args: string[],
    reply: (t: string) => Promise<void>,
  ): Promise<void> {
    const store = this.deps.recipients
    if (!store) return reply("Giving is not enabled on this server.")
    const [sub, ...rest] = args
    if (sub?.toLowerCase() === "remove") {
      const slug = rest[0]?.toLowerCase()
      const r = slug ? await store.get(slug, userId) : null
      if (!r || r.ownerUserId !== userId)
        return reply("You can only remove recipients you added. /recipients lists them.")
      await store.remove(r.slug)
      return reply(`Removed ${r.name}. Any recurring gift to it will pause at its next run.`)
    }
    if (sub?.toLowerCase() !== "add" || rest.length < 2)
      return reply(
        "Usage: /recipient add <lightning address> <name>  ·  /recipient remove <slug>\nExample: /recipient add give@mychurch.org My Church",
      )
    const address = (rest[0] ?? "").toLowerCase()
    const name = rest.slice(1).join(" ").trim().slice(0, 80)
    if (!isLightningAddress(address))
      return reply(`${address} is not a Lightning address (name@domain).`)
    const slug = slugify(name)
    if (!SLUG_RE.test(slug))
      return reply("Give the recipient a name with at least two letters or digits.")
    const existing = await store.get(slug, userId)
    if (existing && existing.ownerUserId !== userId)
      return reply(`“${slug}” is already a directory recipient. Pick a different name.`)
    if (this.deps.probeAddress) {
      const p = await this.deps.probeAddress(address)
      if (!p.ok)
        return reply(
          `That address does not answer Lightning payments right now (${p.error}). Not saved.`,
        )
    }
    await store.upsert({
      slug,
      kind: "creator",
      name,
      lightningAddress: address,
      verified: null,
      ownerUserId: userId,
    })
    return reply(
      `Saved ${name} as ${slug} (private to you). Say “give 1000 sats to ${slug}” or “give 5000 sats to ${slug} every month”.`,
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
      `${lines.join("\n")}\nSay e.g. “support ${active[0]?.recipientSlug} $25 a month” or “give 5000 sats to ${active[0]?.recipientSlug}”. /follow <slug> for updates.`,
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
          ? `Your Lightning address is ${current.name}@${host}${current.forwardTo ? ` (forwards to ${current.forwardTo})` : " (invoices are created by your paired wallet)"}. Share it anywhere; the sats land in your wallet. /address remove to drop it.`
          : `No address yet. Claim one with /address <name> — e.g. /address graham gives you graham@${host}, paying straight into your paired wallet.`,
      )
    }
    if (sub.toLowerCase() === "remove") {
      if (!current) return reply("You have no address.")
      await store.remove(current.name)
      return reply(`Removed ${current.name}@${host}.`)
    }
    if (sub.toLowerCase() === "forward") {
      const to = rest[0]?.toLowerCase() ?? ""
      if (!isLightningAddress(to))
        return reply("Usage: /address forward <lightning address you already have>")
      if (!current) return reply("Claim a name first: /address <name>")
      if (this.deps.probeAddress) {
        const p = await this.deps.probeAddress(to)
        if (!p.ok) return reply(`${to} does not answer Lightning payments (${p.error}).`)
      }
      await store.update({ ...current, forwardTo: to, nwcSealed: undefined })
      return reply(`${current.name}@${host} now forwards to ${to}.`)
    }
    const name = normalizeAddressName(sub)
    if (!name)
      return reply(
        "Names are 2–32 characters: letters, digits, dot, dash, underscore. Some names are reserved.",
      )
    if (current)
      return reply(
        `You already have ${current.name}@${host}. /address remove first if you want ${name}.`,
      )
    if (await store.get(name)) return reply(`${name}@${host} is taken.`)
    const blob = await this.deps.secrets.get(userId, "nwc")
    if (!blob) return reply("Pair your wallet first (/pair): your address pays straight into it.")
    await store.create({ name, userId, nwcSealed: blob, createdAt: this.now().toISOString() })
    return reply(
      `${name}@${host} is yours. Anyone can pay it from any Lightning wallet; each invoice is created by your own wallet and the sats land there. I will tell you when something arrives. Keep your wallet reachable (Alby Hub on, or Coinos).`,
    )
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
    return reply(`${cards.map(line).join("\n")}\n/cards pause <id> to freeze one instantly.`)
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
    return reply(`${bills.map(line).join("\n")}\n/bills cancel <id> to stop one.`)
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
        "Usage: /note <text> — a private note on your last payment · /note <id> <text> · /note clear [id]. Notes stay in your own ledger; the payee never sees them. /notes lists them. In chat: “pay 500 sats to x@y, note: plumber deposit”.",
      )
    let rest = [...args]
    const clear = rest[0]?.toLowerCase() === "clear"
    if (clear) rest = rest.slice(1)
    const entryId = /^act_[0-9a-z_]+$/i.test(rest[0] ?? "") ? (rest.shift() as string) : ""
    const text = clear ? "" : rest.join(" ").trim()
    if (!clear && !text) return reply("Usage: /note <text> · /note <id> <text> · /note clear [id]")
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
          : "No payment to note yet. Notes attach to payments; /ledger shows them.",
      )
    return reply(
      r.result.cleared
        ? `Note removed from “${r.result.summary}” (${r.result.entryId}).`
        : `Noted privately on “${r.result.summary}” (${r.result.entryId}). The payee never sees it; /notes lists your notes.`,
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
        "No private notes yet. Say “pay 500 sats to x@y, note: plumber deposit”, or /note <text> for your last payment. Notes stay in your own ledger; the payee never sees them.",
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
  "Text me in plain words, e.g. “pay 500 sats to gm@getalby.com” or “what's my balance?”.\n/setup — limits wizard\n/pair — connect your wallet\n/key — Strike / Bitrefill keys\n/cold — cold-storage address for sweeps\n/recipients — who you can give to · /recipient add|remove\n/statement — this year's gifts as CSV\n/receive — how a church or creator gets paid through us\n/campaigns — goals you can support · /follow · /unfollow\n/shop — the store · /orders — your orders · /rewards — sats-back\n/invoices — bills you issued (·csv)\n/address — your name@anvard.ai, paid into your own wallet\n/bills — bills you pay in bitcoin · /bills cancel <id>\n/replace — buy back what you spend (on · off · 50% · cap $20)\n/note <text> — a private note on your last payment · /notes — list them\n/budget — show or set limits\n/kill — stop everything\n/resume — lift the kill switch\n/ledger — last actions"

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
    p.replaceSpend?.enabled ? `Replace what you spend: ${describeReplace(p.replaceSpend)}` : "",
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

export function describeReplace(r: NonNullable<Policy["replaceSpend"]>): string {
  return `${r.percent}% of every spend bought back on ${r.exchange}${r.toWallet ? " and swept into your wallet" : ""} · spends under ${formatCents(r.minUsdCents)} skipped · at most ${formatCents(r.dailyCapUsdCents)} a day`
}

/**
 * `/replace` · `/replace on [percent]` · `/replace off` · `/replace cap <dollars>` · `/replace min <dollars>` ·
 * `/replace wallet on|off`. Pure. Turning it on needs an exchange key; it also switches the exchange rail on,
 * because that is what the person just asked for.
 */
export function applyReplaceArgs(
  p: Policy,
  args: string[],
  now: Date,
  hasExchange: boolean,
): { ok: true; policy: Policy; text: string } | { ok: false; error: string } {
  const [key, ...rest] = args
  const cur = p.replaceSpend
  const usage =
    "Usage: /replace on [percent] · /replace off · /replace cap <dollars per day> · /replace min <dollars> · /replace wallet on|off"
  const show = (r: NonNullable<Policy["replaceSpend"]>) =>
    r.enabled
      ? `Replace is ON: ${describeReplace(r)}.
/replace off to stop.`
      : "Replace is off. /replace on buys back what you spend on your own Strike account; /replace on 50 buys back half."
  if (!key) return { ok: true, policy: p, text: show(cur ?? replaceSetting({}, now)) }
  const dollars = (v: string | undefined): bigint | null => {
    const m = /^\$?(\d{1,6})(?:\.(\d{1,2}))?$/.exec(v ?? "")
    if (!m) return null
    return BigInt(m[1] ?? "0") * 100n + BigInt((m[2] ?? "").padEnd(2, "0"))
  }
  switch (key.toLowerCase()) {
    case "on": {
      const pct = rest[0] ? Number(rest[0].replace(/%$/, "")) : (cur?.percent ?? 100)
      if (!Number.isInteger(pct) || pct < 1 || pct > 100)
        return { ok: false, error: "Percent is a whole number from 1 to 100." }
      if (!hasExchange)
        return {
          ok: false,
          error:
            "Replace buys on your own exchange account. Add a Strike key first: /key strike <key>.",
        }
      const r = replaceSetting(
        { ...cur, enabled: true, percent: pct, since: now.toISOString() },
        now,
      )
      const policy: Policy = { ...p, replaceSpend: r, rails: { ...p.rails, exchange: true } }
      return {
        ok: true,
        policy,
        text: `Replace is ON from now: ${describeReplace(r)}. Each buy-back goes through your limits and shows in /ledger.${p.rails.exchange ? "" : " The exchange rail is now on."}`,
      }
    }
    case "off": {
      if (!cur?.enabled) return { ok: true, policy: p, text: "Replace is already off." }
      return {
        ok: true,
        policy: { ...p, replaceSpend: { ...cur, enabled: false } },
        text: "Replace is off. Nothing already bought changes.",
      }
    }
    case "cap": {
      const c = dollars(rest[0])
      if (c === null || c < 100n)
        return { ok: false, error: "Cap is dollars a day, at least $1: /replace cap 20" }
      const r = replaceSetting({ ...cur, dailyCapUsdCents: c }, now)
      return { ok: true, policy: { ...p, replaceSpend: r }, text: show(r) }
    }
    case "min": {
      const c = dollars(rest[0])
      if (c === null) return { ok: false, error: "Minimum is dollars: /replace min 1" }
      const r = replaceSetting({ ...cur, minUsdCents: c }, now)
      return { ok: true, policy: { ...p, replaceSpend: r }, text: show(r) }
    }
    case "wallet": {
      const v = rest[0]?.toLowerCase()
      if (v !== "on" && v !== "off") return { ok: false, error: usage }
      const r = replaceSetting({ ...cur, toWallet: v === "on" }, now)
      return { ok: true, policy: { ...p, replaceSpend: r }, text: show(r) }
    }
    default:
      return { ok: false, error: usage }
  }
}
