import { createHash } from "node:crypto"
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
  FakeWalletRail,
  type GoodsRail,
  InMemoryLedgerStore,
  InMemoryOrderStore,
  InMemoryProductStore,
  InMemoryRecipientStore,
  type LedgerStore,
  type PriceSnapshot,
  type RecipientStore,
  type WalletRail,
  contributionSink,
  recipientsForUser,
} from "@agentic-bitcoin/core"
import {
  BitrefillGoodsRail,
  CompositeGoodsRail,
  DirectoryGoodsRail,
  LndOnChainRail,
  NwcWalletRail,
  StrikeExchangeRail,
  decryptSecret,
  encryptSecret,
  parseKey,
  probeLightningAddress,
} from "@agentic-bitcoin/rails"
import {
  InMemoryScheduleStore,
  SupabaseScheduleStore,
  makeSweep,
  runDue,
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
  FileOrderStore,
  FileProductStore,
  SupabaseOrderStore,
  SupabaseProductStore,
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
  env.SURFACE === "signal"
    ? new SignalSurface({
        daemonUrl: env.SIGNAL_DAEMON_URL ?? "http://localhost:8080",
        account: env.SIGNAL_ACCOUNT ?? "",
        multiAccount: env.SIGNAL_MULTI_ACCOUNT === "1",
        noteToSelf: env.SIGNAL_NOTE_TO_SELF === "1",
      })
    : new TelegramSurface(env.TELEGRAM_BOT_TOKEN ?? "")
if (surface.kind === "telegram" && !env.TELEGRAM_BOT_TOKEN) {
  console.error("Set TELEGRAM_BOT_TOKEN (or SURFACE=signal with SIGNAL_ACCOUNT)")
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

const dispatcher = new Dispatcher({
  surface,
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
  inviteCode: env.BOT_INVITE_CODE,
  allowedUsers: env.BOT_ALLOWED_USERS?.split(",")
    .map((u) => u.trim())
    .filter(Boolean),
})
await dispatcher.start()

// Scheduler: once a minute, fire due recurring buys through the same policy + ledger (ADR-0010).
const sweep = makeSweep((rails) =>
  rails.exchange instanceof StrikeExchangeRail ? rails.exchange : null,
)
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
        }
      },
      price,
      sweep,
      recipients: (userId) => recipientsForUser(recipientStore, userId),
      log: (l) => console.error(`[scheduler] ${l}`),
    })
    for (const f of r.fired) {
      await surface.send(f.userId, {
        text: `Scheduled action ${f.status}${f.detail ? `: ${f.detail}` : ""}.`,
      })
    }
  } catch (err) {
    console.error("[scheduler] run failed", err)
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
