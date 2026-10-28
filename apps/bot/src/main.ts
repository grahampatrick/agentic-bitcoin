import { createHash, randomBytes } from "node:crypto"
/**
 * Bot entrypoint. SURFACE=telegram|signal. With SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY the
 * stores are durable; otherwise everything is in memory (dev). NWC_URL is the single dev wallet
 * until per-user pairing lands in M7; without it, the FAKE wallet is used.
 */
import {
  AnthropicLlmClient,
  InMemoryPendingStore,
  type PendingStore,
  ScriptedLlmClient,
  type UserContext,
} from "@agentic-bitcoin/agent"
import {
  DEFAULT_POLICY,
  DEFAULT_REFERRAL_RULES,
  DEFAULT_REWARD_RATES,
  FakeWalletRail,
  type GoodsRail,
  InMemoryCardStore,
  InMemoryInvoiceStore,
  InMemoryLedgerStore,
  InMemoryLightningAddressStore,
  InMemoryOrderStore,
  InMemoryProductStore,
  InMemoryRecipientStore,
  InMemoryReferralStore,
  InMemoryRewardStore,
  type LedgerStore,
  type PriceSnapshot,
  type RecipientStore,
  type ReferralRules,
  type RewardRates,
  type WalletRail,
  actionHash,
  contributionSink,
  formatCents,
  formatSats,
  invoiceStatus,
  qualifyReferral,
  readEntries,
  recipientsForUser,
  referralsEnabled,
  rewardSink,
} from "@agentic-bitcoin/core"
import {
  BitrefillGoodsRail,
  CompositeGoodsRail,
  DirectoryGoodsRail,
  LndOnChainRail,
  NwcWalletRail,
  RemoteMerchantRail,
  StrikeExchangeRail,
  decryptSecret,
  encryptSecret,
  fetchManifest,
  parseKey,
  probeLightningAddress,
} from "@agentic-bitcoin/rails"
import {
  InMemoryScheduleStore,
  SupabaseScheduleStore,
  makeSweep,
  runDue,
  runReplacementsFor,
  runRewardPayouts,
  schedulesHook,
} from "@agentic-bitcoin/scheduler"
import { Dispatcher } from "./dispatcher"
import { FileCampaignStore, SupabaseCampaignStore, deliverCampaignUpdates } from "./store/campaigns"
import {
  FileHistoryStore,
  FilePolicyStore,
  FileRecipientStore,
  FileSecretStore,
  FileState,
} from "./store/file"
import { SupabaseRecipientStore, seedRecipients } from "./store/recipients"
import {
  FileCardStore,
  FileInvoiceStore,
  FileLightningAddressStore,
  FileOrderStore,
  FileProductStore,
  FileReferralStore,
  FileRewardStore,
  SupabaseCardStore,
  SupabaseInvoiceStore,
  SupabaseLightningAddressStore,
  SupabaseOrderStore,
  SupabaseProductStore,
  SupabaseReceiveInvoiceWatch,
  SupabaseReferralStore,
  SupabaseRewardStore,
  seedShop,
} from "./store/shop"
import {
  InMemoryHistoryStore,
  InMemoryPolicyStore,
  InMemorySecretStore,
  type LedgerStoreFactory,
  type SecretName,
} from "./store/stores"
import {
  SupabaseHistoryStore,
  SupabaseLedgerFactory,
  SupabasePolicyStore,
  SupabaseSecretStore,
  supabaseClient,
} from "./store/supabase"
import { DiscordSurface } from "./surfaces/discord"
import { SignalSurface } from "./surfaces/signal"
import { TelegramSurface } from "./surfaces/telegram"

// Load apps/bot/.env (KEY=value lines) without a dependency; real env wins over the file.
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
const envFile = join(dirname(fileURLToPath(import.meta.url)), "..", ".env")
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(?:#.*)?$/.exec(line)
    if (m?.[1] && process.env[m[1]] === undefined && m[2] !== undefined && m[2] !== "")
      process.env[m[1]] = m[2]
  }
}
const env = process.env
const liveModel = !!(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN)
if (!liveModel)
  console.warn("[bot] no ANTHROPIC_API_KEY — using the SCRIPTED model (fixed phrasings only)")
const durable = !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY)
const db = durable
  ? supabaseClient(env.SUPABASE_URL as string, env.SUPABASE_SERVICE_ROLE_KEY as string)
  : null
// Without Supabase, keep policies, (encrypted) secrets and history in apps/bot/.data so restarts don't lose a pairing.
const fileState = db
  ? null
  : new FileState(join(dirname(fileURLToPath(import.meta.url)), "..", ".data", "state.json"))
const policies = db
  ? new SupabasePolicyStore(db)
  : fileState
    ? new FilePolicyStore(fileState)
    : new InMemoryPolicyStore()
const secrets = db
  ? new SupabaseSecretStore(db)
  : fileState
    ? new FileSecretStore(fileState)
    : new InMemorySecretStore()
const history = db
  ? new SupabaseHistoryStore(db)
  : fileState
    ? new FileHistoryStore(fileState)
    : new InMemoryHistoryStore()
const memoryLedgers = new Map<string, LedgerStore>()
const ledgers: LedgerStoreFactory = db
  ? new SupabaseLedgerFactory(db)
  : {
      forUser: (u) => {
        const existing = memoryLedgers.get(u)
        if (existing) return existing
        const created = new InMemoryLedgerStore()
        memoryLedgers.set(u, created)
        return created
      },
    }
const recipientStore: RecipientStore = db
  ? new SupabaseRecipientStore(db)
  : fileState
    ? new FileRecipientStore(fileState)
    : new InMemoryRecipientStore()
if (env.RECIPIENTS_FILE) {
  const n = await seedRecipients(recipientStore, env.RECIPIENTS_FILE)
  console.error(`[bot] giving directory: ${n} recipients loaded from ${env.RECIPIENTS_FILE}`)
}
const campaignStore = db
  ? new SupabaseCampaignStore(db)
  : fileState
    ? new FileCampaignStore(fileState)
    : null
const productStore = db
  ? new SupabaseProductStore(db)
  : fileState
    ? new FileProductStore(fileState)
    : new InMemoryProductStore()
const orderStore = db
  ? new SupabaseOrderStore(db)
  : fileState
    ? new FileOrderStore(fileState)
    : new InMemoryOrderStore()
if (env.SHOP_FILE) {
  const n = await seedShop(productStore, env.SHOP_FILE)
  console.error(`[bot] storefront: ${n} products loaded from ${env.SHOP_FILE}`)
}
// M14: issued invoices; our pay links point at BOLT11s minted on the issuer's wallet.
const invoiceStore = db
  ? new SupabaseInvoiceStore(db)
  : fileState
    ? new FileInvoiceStore(fileState)
    : new InMemoryInvoiceStore()
const siteUrl = env.SITE_URL ?? "https://agentic-bitcoin.vercel.app"
const payLinks = {
  async resolve(token: string) {
    const i = await invoiceStore.getByToken(token)
    if (!i || i.state !== "open" || !i.bolt11 || !i.amountSats) return null
    if (i.expiresAt && i.expiresAt < new Date().toISOString()) return null
    return { bolt11: i.bolt11, amountSats: i.amountSats, destination: `invoice:${i.issuer}` }
  },
}
// M16: remote shops (recipients with a manifest host) become goods rails; their feeds are mirrored into the catalogue.
const remoteRails = new Map<string, RemoteMerchantRail>()
async function loadRemoteShops(): Promise<void> {
  const shops = (await recipientStore.list()).filter(
    (r) => r.kind === "merchant" && r.verified && r.manifestHost,
  )
  for (const r of shops) {
    try {
      if (!remoteRails.has(r.slug)) {
        const manifest = await fetchManifest(r.manifestHost as string)
        remoteRails.set(
          r.slug,
          new RemoteMerchantRail({
            manifest,
            price,
            siteUrl: env.SITE_URL ?? "https://agentic-bitcoin.vercel.app",
          }),
        )
      }
      const rail = remoteRails.get(r.slug) as RemoteMerchantRail
      const products = await rail.products()
      const existing = await productStore.listForMerchant(r.slug)
      const keep = new Set(products.map((p) => p.id))
      for (const p of products) await productStore.upsert(p)
      for (const e of existing) if (!keep.has(e.id)) await productStore.remove(r.slug, e.id)
      console.error(`[shops] ${r.slug}: ${products.length} products from ${r.manifestHost}`)
    } catch (err) {
      console.error(`[shops] ${r.slug}: ${(err as Error).message}`)
    }
  }
}
await loadRemoteShops()
let shopSyncAt = Date.now()
// M17a: virtual cards — scoped monthly budgets on the user's own wallet (ADR-0021).
const cardStore = db
  ? new SupabaseCardStore(db)
  : fileState
    ? new FileCardStore(fileState)
    : new InMemoryCardStore()
const newViewToken = () => {
  const token = randomBytes(16).toString("hex")
  return { token, hash: createHash("sha256").update(token).digest("hex") }
}
// M15: lightning addresses (name@host → the user's own wallet). The web mints; the bot watches settlement.
const addressStore = db
  ? new SupabaseLightningAddressStore(db)
  : fileState
    ? new FileLightningAddressStore(fileState)
    : new InMemoryLightningAddressStore()
const receiveWatch = db ? new SupabaseReceiveInvoiceWatch(db) : null
if (!db)
  console.warn("[bot] no SUPABASE env — /address claims work only once the web shares the database")
// M13: sats-back. Rates are operator config; payouts come from the operator's own wallet (REWARDS_NWC_URL)
// under the operator's own caps. Without that wallet, rewards accrue and show as payable, never paid.
const rewardStore = db
  ? new SupabaseRewardStore(db)
  : fileState
    ? new FileRewardStore(fileState)
    : new InMemoryRewardStore()
const rewardRates: RewardRates = {
  ...DEFAULT_REWARD_RATES,
  bps: {
    ...DEFAULT_REWARD_RATES.bps,
    directory: Number(env.REWARDS_BPS_DIRECTORY ?? DEFAULT_REWARD_RATES.bps.directory),
    bitrefill: Number(env.REWARDS_BPS_BITREFILL ?? DEFAULT_REWARD_RATES.bps.bitrefill),
  },
  minPayoutSats: BigInt(env.REWARDS_MIN_PAYOUT_SATS ?? DEFAULT_REWARD_RATES.minPayoutSats),
}
let rewardSeq = 0
const rewards = rewardSink(
  rewardStore,
  rewardRates,
  () => `rw_${Date.now().toString(36)}_${(++rewardSeq).toString(36)}`,
)
const rewardsWallet = env.REWARDS_NWC_URL
  ? new NwcWalletRail({ connectionString: env.REWARDS_NWC_URL })
  : null
const rewardsLedger = new InMemoryLedgerStore() // the operator's payout ledger (durable store is a later step)
const rewardsPolicy = {
  ...DEFAULT_POLICY,
  dailyCapSats: BigInt(env.REWARDS_DAILY_CAP_SATS ?? "50000"),
  perActionCapSats: BigInt(env.REWARDS_DAILY_CAP_SATS ?? "50000"),
  confirmAboveSats: 1_000_000_000n,
}
if (!rewardsWallet)
  console.warn("[bot] REWARDS_NWC_URL not set — sats-back accrues but is not paid out")
// M22: referral rewards in sats (ADR-0025). Flat amounts from env; off until one side pays something.
const referralRules: ReferralRules = {
  ...DEFAULT_REFERRAL_RULES,
  referrerSats: BigInt(env.REFERRAL_REWARD_SATS ?? "0"),
  friendSats: BigInt(env.REFERRAL_FRIEND_SATS ?? "0"),
  qualifyingSats: BigInt(env.REFERRAL_MIN_SPEND_SATS ?? DEFAULT_REFERRAL_RULES.qualifyingSats),
  maxPerReferrerPerMonth: Number(
    env.REFERRAL_MAX_PER_MONTH ?? DEFAULT_REFERRAL_RULES.maxPerReferrerPerMonth,
  ),
}
const referralStore = db
  ? new SupabaseReferralStore(db)
  : fileState
    ? new FileReferralStore(fileState)
    : new InMemoryReferralStore(() => randomBytes(1)[0] as number)
let referralSeq = 0
const referrals = {
  store: referralStore,
  rules: referralRules,
  newId: () => `rf_${Date.now().toString(36)}_${(++referralSeq).toString(36)}`,
}
if (!referralsEnabled(referralRules))
  console.warn(
    "[bot] REFERRAL_REWARD_SATS / REFERRAL_FRIEND_SATS not set — referral rewards are off",
  )
/** Opaque supporter identity for campaign counts: a hash, never the user id (salted by SECRETS_KEY when set). */
const supporterKeyOf = (userId: string) =>
  createHash("sha256")
    .update(`supporter:${env.SECRETS_KEY ?? ""}:${userId}`)
    .digest("hex")
    .slice(0, 16)
const pending: PendingStore = new InMemoryPendingStore()
const schedules = db ? new SupabaseScheduleStore(db) : new InMemoryScheduleStore()
const secretsKey = env.SECRETS_KEY ? parseKey(env.SECRETS_KEY) : null
if (!durable)
  console.warn("[bot] no SUPABASE env — file store at apps/bot/.data/state.json (single operator)")
if (!secretsKey)
  console.warn(
    "[bot] SECRETS_KEY not set — /pair and /key are disabled; using env credentials only",
  )
if (!env.NWC_URL) console.warn("[bot] NWC_URL not set — users without /pair get the FAKE wallet")

/** Per-user credential → rail cache, rebuilt when /pair or /key changes something. */
const railCache = new Map<
  string,
  { wallet: WalletRail; exchange?: StrikeExchangeRail; goods?: GoodsRail; onchain?: LndOnChainRail }
>()
async function secret(userId: string, name: SecretName): Promise<string | null> {
  if (!secretsKey) return null
  const blob = await secrets.get(userId, name)
  return blob ? decryptSecret(blob, secretsKey) : null
}
async function railsFor(userId: string) {
  const cached = railCache.get(userId)
  if (cached) return cached
  const nwc = (await secret(userId, "nwc")) ?? env.NWC_URL
  const strikeKey = (await secret(userId, "strike")) ?? env.STRIKE_API_KEY
  const bitrefillKey = (await secret(userId, "bitrefill")) ?? env.BITREFILL_API_KEY
  const built = {
    wallet: nwc ? new NwcWalletRail({ connectionString: nwc }) : new FakeWalletRail(),
    // On-chain (M8): operator-level LND for now; per-user node credentials are a later step.
    onchain:
      env.LND_REST_URL && env.LND_MACAROON_HEX
        ? new LndOnChainRail({ baseUrl: env.LND_REST_URL, macaroonHex: env.LND_MACAROON_HEX })
        : undefined,
    exchange: strikeKey ? new StrikeExchangeRail({ apiKey: strikeKey }) : undefined,
    // M12: one goods socket — storefront merchants (invoices from their wallets) plus Bitrefill when keyed.
    goods: new CompositeGoodsRail(
      new DirectoryGoodsRail({
        products: productStore,
        orders: orderStore,
        merchant: (slug) => recipientStore.get(slug),
        price,
        secretsKey,
        walletFor: (cs) => new NwcWalletRail({ connectionString: cs }),
        siteUrl: env.SITE_URL ?? "https://agentic-bitcoin.vercel.app",
        buyerKey: supporterKeyOf(userId),
      }),
      bitrefillKey ? new BitrefillGoodsRail({ apiKey: bitrefillKey }) : undefined,
      remoteRails,
    ),
  }
  railCache.set(userId, built)
  return built
}
function onCredentialsChanged(userId: string): void {
  railCache.get(userId)?.wallet && (railCache.get(userId)?.wallet as NwcWalletRail).close?.()
  railCache.delete(userId)
}
async function probeWallet(connectionString: string) {
  const rail = new NwcWalletRail({ connectionString })
  try {
    return await rail.describeConnection()
  } finally {
    rail.close()
  }
}

async function resolveContext(userId: string): Promise<UserContext> {
  const rails = await railsFor(userId)
  return {
    userId,
    policy: (await policies.get(userId)) ?? DEFAULT_POLICY,
    ledger: ledgers.forUser(userId),
    rails,
    // gift-card codes are sealed into the ledger only when SECRETS_KEY exists; otherwise never stored
    seal: secretsKey ? (s: string) => encryptSecret(s, secretsKey) : undefined,
    pending,
    schedules: schedulesHook(schedules, {
      sweepToWallet: env.SWEEP_TO_WALLET === "1",
      userId,
      supporterKey: supporterKeyOf(userId),
      campaigns: campaignStore ?? undefined,
    }),
    recipients: recipientsForUser(recipientStore, userId),
    campaigns: campaignStore ?? undefined,
    contributions: campaignStore ? contributionSink(campaignStore) : undefined,
    supporterKey: supporterKeyOf(userId),
    rewards,
    rewardStore,
    invoices: { store: invoiceStore, issuer: userId, siteUrl },
    cards: { store: cardStore, siteUrl, newViewToken },
    referrals: { store: referralStore, rules: referralRules, siteUrl },
    payLinks,
  }
}

async function price(): Promise<PriceSnapshot | undefined> {
  try {
    const res = await fetch(env.PRICE_URL ?? "https://mempool.space/api/v1/prices", {
      signal: AbortSignal.timeout(4000),
    })
    const j = (await res.json()) as { USD?: number }
    if (typeof j.USD !== "number") return undefined
    return {
      usdCentsPerBtc: BigInt(Math.round(j.USD * 100)),
      asOf: new Date().toISOString(),
      source: "mempool.space",
    } // money-ok: boundary
  } catch {
    return undefined
  }
}

const surface =
  env.SURFACE === "discord"
    ? new DiscordSurface(env.DISCORD_BOT_TOKEN ?? "")
    : env.SURFACE === "signal"
      ? new SignalSurface({
          daemonUrl: env.SIGNAL_DAEMON_URL ?? "http://localhost:8080",
          account: env.SIGNAL_ACCOUNT ?? "",
          multiAccount: env.SIGNAL_MULTI_ACCOUNT === "1",
          noteToSelf: env.SIGNAL_NOTE_TO_SELF === "1",
        })
      : new TelegramSurface(env.TELEGRAM_BOT_TOKEN ?? "")
if (surface.kind === "telegram" && !env.TELEGRAM_BOT_TOKEN) {
  console.error(
    "Set TELEGRAM_BOT_TOKEN (or SURFACE=signal with SIGNAL_ACCOUNT, or SURFACE=discord with DISCORD_BOT_TOKEN)",
  )
  process.exit(2)
}
if (surface.kind === "discord" && !env.DISCORD_BOT_TOKEN) {
  console.error(
    "Set DISCORD_BOT_TOKEN (Discord Developer Portal → Bot → token; enable the Message Content intent)",
  )
  process.exit(2)
}
if (surface instanceof SignalSurface) {
  if (!env.SIGNAL_ACCOUNT) {
    console.error("Set SIGNAL_ACCOUNT to the bot's registered number (docs/signal.md)")
    process.exit(2)
  }
  if (
    env.SIGNAL_NOTE_TO_SELF === "1" &&
    !env.BOT_ALLOWED_USERS?.includes(`signal:${env.SIGNAL_ACCOUNT}`)
  ) {
    console.error(
      "SIGNAL_NOTE_TO_SELF=1 is a test mode on YOUR account: set BOT_ALLOWED_USERS=signal:<your number> so the bot answers nobody else",
    )
    process.exit(2)
  }
  if (!(await surface.check())) {
    console.error(
      `signal-cli daemon not reachable at ${env.SIGNAL_DAEMON_URL ?? "http://localhost:8080"} — start it: signal-cli -a ${env.SIGNAL_ACCOUNT} daemon --http localhost:8080 --no-receive-stdout`,
    )
    process.exit(2)
  }
}

const sweep = makeSweep((rails) =>
  rails.exchange instanceof StrikeExchangeRail ? rails.exchange : null,
)
// M19: replace the bitcoin you spend. After any spend, buy it back on the user's own exchange (ADR-0022).
const replaceAfter = async (userId: string) => {
  try {
    const r = await runReplacementsFor(userId, {
      resolve: async (u) => {
        const c = await resolveContext(u)
        return { policy: c.policy, ledger: c.ledger, rails: c.rails }
      },
      price,
      sweep,
      log: (l) => console.error(`[replace] ${l}`),
    })
    for (const d of r.done) {
      await surface.send(userId, {
        text:
          d.status === "succeeded"
            ? `Replaced: bought ${formatSats(d.boughtSats ?? 0n)} for ${formatCents(d.usdCents ?? 0n)} after your ${formatSats(d.spentSats)} spend${d.swept ? ", swept into your wallet" : ""}.${d.detail ? ` ${d.detail}` : ""}`
            : `Replace skipped for your ${formatSats(d.spentSats)} spend: ${d.detail ?? d.status}. It will not be retried.`,
      })
    }
  } catch (err) {
    console.error("[replace] run failed", err)
  }
}

// M22: after a spend, a referred friend's first qualifying payment records the two rewards (paid by the rewards run).
const qualifyAfter = async (userId: string) => {
  try {
    const q = await qualifyReferral(
      {
        referrals: referralStore,
        rewards: rewardStore,
        rules: referralRules,
        newRewardId: () => `rw_${Date.now().toString(36)}_${(++rewardSeq).toString(36)}`,
      },
      userId,
      await readEntries(ledgers.forUser(userId)),
    )
    if (!q) return
    const friend = q.rewards.find((r) => r.userId === userId)
    const referrer = q.rewards.find((r) => r.userId === q.referral.referrerId)
    await surface.send(userId, {
      text: friend
        ? `Your first payment counted: ${formatSats(friend.amountSats)} of referral reward is coming to your wallet (paid automatically; /rewards).`
        : "Your first payment counted toward your friend's referral.",
    })
    if (referrer)
      await surface.send(q.referral.referrerId, {
        text: `A friend you invited made their first payment: ${formatSats(referrer.amountSats)} is coming to your wallet (paid automatically; /refer for your tally).`,
      })
  } catch (err) {
    console.error("[referrals]", err)
  }
}
const afterSpend = async (userId: string) => {
  await replaceAfter(userId)
  await qualifyAfter(userId)
}
const dispatcher = new Dispatcher({
  surface,
  afterSpend,
  referrals,
  agent: { llm: liveModel ? new AnthropicLlmClient() : new ScriptedLlmClient(), price },
  resolveContext,
  policies,
  history,
  secrets,
  secretsKey,
  probeWallet,
  onCredentialsChanged,
  recipients: recipientStore,
  probeAddress: (a) => probeLightningAddress(a),
  operators: env.BOT_OPERATORS?.split(",")
    .map((u) => u.trim())
    .filter(Boolean),
  siteUrl: env.SITE_URL ?? "https://agentic-bitcoin.vercel.app",
  campaigns: campaignStore ?? undefined,
  orders: orderStore,
  buyerKeyOf: supporterKeyOf,
  rewardStore,
  invoiceStore,
  cards: cardStore,
  addresses: addressStore,
  inviteCode: env.BOT_INVITE_CODE,
  allowedUsers: env.BOT_ALLOWED_USERS?.split(",")
    .map((u) => u.trim())
    .filter(Boolean),
})
await dispatcher.start()

// Scheduler: once a minute, fire due recurring buys through the same policy + ledger (ADR-0010).
const runSchedules = async () => {
  try {
    const r = await runDue({
      schedules,
      resolve: async (userId) => {
        const c = await resolveContext(userId)
        return {
          policy: c.policy,
          ledger: c.ledger,
          rails: c.rails,
          contributions: c.contributions,
          supporterKey: c.supporterKey,
          invoices: c.invoices,
        }
      },
      price,
      sweep,
      recipients: (userId) => recipientsForUser(recipientStore, userId),
      // M20: an ask-mode bill parks the payment for the user's plain "yes" (same path as any confirmation).
      ask: async (userId, action, summary) => {
        const c = await resolveContext(userId)
        const hash = actionHash(action)
        await c.pending.set(userId, hash, action)
        const text = `${summary} is due. Reply yes to pay it from your wallet, or no to skip this month.`
        await surface.send(userId, { text, confirm: { actionHash: hash } })
        return text
      },
      log: (l) => console.error(`[scheduler] ${l}`),
    })
    for (const f of r.fired) {
      await surface.send(f.userId, {
        text: `Scheduled action ${f.status}${f.detail ? `: ${f.detail}` : ""}.`,
      })
    }
    for (const u of new Set(r.fired.map((f) => f.userId))) await afterSpend(u)
  } catch (err) {
    console.error("[scheduler] run failed", err)
  }
  // M16: refresh remote shop feeds every 30 minutes.
  if (Date.now() - shopSyncAt > 30 * 60_000) {
    shopSyncAt = Date.now()
    await loadRemoteShops()
  }
  // M15: payments to name@host arrive in the user's own wallet; notice them there and say so.
  if (receiveWatch) {
    try {
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
      for (const inv of await receiveWatch.listUnsettled("addr:", since, 25)) {
        const name = inv.slug.slice("addr:".length)
        const a = await addressStore.get(name)
        if (!a || a.forwardTo) continue
        const w = (await railsFor(a.userId)).wallet
        if (w instanceof FakeWalletRail) continue
        try {
          const look = await w.lookupInvoice(inv.paymentHash)
          if (look.state === "settled") {
            await receiveWatch.markSettled(
              inv.paymentHash,
              look.settledAt ?? new Date().toISOString(),
              look.preimage,
            )
            await surface.send(a.userId, {
              text: `Received ${formatSats(BigInt(Math.floor(inv.amountMsats / 1000)))} at ${name}@${new URL(siteUrl).host}${inv.comment ? ` — “${inv.comment.slice(0, 120)}”` : ""}.`,
            })
          }
        } catch {
          /* wallet unreachable: next minute */
        }
      }
    } catch (err) {
      console.error("[addresses] settlement check failed", err)
    }
  }
  // M14: watch open invoices for settlement on the issuer's own wallet; tell the issuer when one is paid.
  try {
    const open = (await invoiceStore.listOpenMinted())
      .filter((i) => !i.issuer.startsWith("recipient:"))
      .slice(0, 25)
    for (const i of open) {
      if (!i.paymentHash || invoiceStatus(i, new Date()) === "expired") continue
      const w = (await railsFor(i.issuer)).wallet
      if (w instanceof FakeWalletRail) continue
      try {
        const look = await w.lookupInvoice(i.paymentHash)
        if (look.state === "settled") {
          await invoiceStore.update({
            ...i,
            state: "paid",
            paidAt: look.settledAt ?? new Date().toISOString(),
            preimage: look.preimage,
          })
          await surface.send(i.issuer, {
            text: `Paid: ${i.number} from ${i.payerName}, ${formatCents(i.totalCents)} (${formatSats(i.amountSats ?? 0n)}).`,
          })
        }
      } catch {
        /* wallet unreachable: try next minute */
      }
    }
  } catch (err) {
    console.error("[invoices] settlement check failed", err)
  }
  // M13: pay out sats-back from the operator wallet (chat buyers: an invoice on their own paired wallet).
  if (rewardsWallet) {
    try {
      const r = await runRewardPayouts({
        store: rewardStore,
        rates: rewardRates,
        operator: {
          policy: rewardsPolicy,
          ledger: rewardsLedger,
          rails: { wallet: rewardsWallet },
        },
        invoiceFor: async (payee, sats) => {
          if (payee.userId) {
            const w = (await railsFor(payee.userId)).wallet
            if (w instanceof FakeWalletRail) return null
            const inv = await w.makeInvoice({
              amountSats: sats,
              memo: "Agentic Bitcoin sats-back",
              expirySeconds: 3600,
            })
            return { bolt11: inv.bolt11 }
          }
          if (payee.payoutAddress)
            return rewardsWallet.resolveAddress(
              payee.payoutAddress,
              sats,
              "Agentic Bitcoin sats-back",
            )
          return null
        },
        log: (l) => console.error(`[rewards] ${l}`),
      })
      for (const p of r.paid)
        if (p.payee.startsWith("signal:") || p.payee.startsWith("telegram:"))
          await surface.send(p.payee, {
            text: `Rewards paid: ${formatSats(p.sats)} to your wallet (${p.rewards} reward${p.rewards === 1 ? "" : "s"}).`,
          })
    } catch (err) {
      console.error("[rewards] payout run failed", err)
    }
  }
  // M11: campaign updates to followers, once each.
  if (campaignStore) {
    try {
      const n = await deliverCampaignUpdates(
        campaignStore,
        (u, text) => surface.send(u, { text }),
        {
          siteUrl: env.SITE_URL ?? "https://agentic-bitcoin.vercel.app",
        },
      )
      if (n) console.error(`[campaigns] delivered ${n} update message(s)`)
    } catch (err) {
      console.error("[campaigns] delivery failed", err)
    }
  }
}
setInterval(runSchedules, 60_000)
void runSchedules()
console.error(`[bot] ${surface.kind} surface up · ${durable ? "supabase" : "memory"} stores`)
