/**
 * Bot entrypoint. SURFACE=telegram|signal. With SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY the
 * stores are durable; otherwise everything is in memory (dev). NWC_URL is the single dev wallet
 * until per-user pairing lands in M7; without it, the FAKE wallet is used.
 */
import {
  AnthropicLlmClient,
  InMemoryPendingStore,
  type PendingStore,
  type UserContext,
} from "@agentic-bitcoin/agent"
import {
  DEFAULT_POLICY,
  FakeWalletRail,
  InMemoryLedgerStore,
  type LedgerStore,
  type PriceSnapshot,
  type WalletRail,
} from "@agentic-bitcoin/core"
import {
  BitrefillGoodsRail,
  NwcWalletRail,
  StrikeExchangeRail,
  decryptSecret,
  encryptSecret,
  parseKey,
} from "@agentic-bitcoin/rails"
import {
  InMemoryScheduleStore,
  SupabaseScheduleStore,
  makeSweep,
  runDue,
  schedulesHook,
} from "@agentic-bitcoin/scheduler"
import { Dispatcher } from "./dispatcher"
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

const env = process.env
const durable = !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY)
const db = durable
  ? supabaseClient(env.SUPABASE_URL as string, env.SUPABASE_SERVICE_ROLE_KEY as string)
  : null
const policies = db ? new SupabasePolicyStore(db) : new InMemoryPolicyStore()
const secrets = db ? new SupabaseSecretStore(db) : new InMemorySecretStore()
const history = db ? new SupabaseHistoryStore(db) : new InMemoryHistoryStore()
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
const pending: PendingStore = new InMemoryPendingStore()
const schedules = db ? new SupabaseScheduleStore(db) : new InMemoryScheduleStore()
const secretsKey = env.SECRETS_KEY ? parseKey(env.SECRETS_KEY) : null
if (!durable) console.warn("[bot] no SUPABASE env — in-memory stores (non-durable)")
if (!secretsKey)
  console.warn(
    "[bot] SECRETS_KEY not set — /pair and /key are disabled; using env credentials only",
  )
if (!env.NWC_URL) console.warn("[bot] NWC_URL not set — users without /pair get the FAKE wallet")

/** Per-user credential → rail cache, rebuilt when /pair or /key changes something. */
const railCache = new Map<
  string,
  { wallet: WalletRail; exchange?: StrikeExchangeRail; goods?: BitrefillGoodsRail }
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
    exchange: strikeKey ? new StrikeExchangeRail({ apiKey: strikeKey }) : undefined,
    goods: bitrefillKey ? new BitrefillGoodsRail({ apiKey: bitrefillKey }) : undefined,
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
    schedules: schedulesHook(schedules, { sweepToWallet: env.SWEEP_TO_WALLET === "1" }),
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
      })
    : new TelegramSurface(env.TELEGRAM_BOT_TOKEN ?? "")
if (surface.kind === "telegram" && !env.TELEGRAM_BOT_TOKEN) {
  console.error("Set TELEGRAM_BOT_TOKEN (or SURFACE=signal with SIGNAL_ACCOUNT)")
  process.exit(2)
}

const dispatcher = new Dispatcher({
  surface,
  agent: { llm: new AnthropicLlmClient(), price },
  resolveContext,
  policies,
  history,
  secrets,
  secretsKey,
  probeWallet,
  onCredentialsChanged,
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
        return { policy: c.policy, ledger: c.ledger, rails: c.rails }
      },
      price,
      sweep,
      log: (l) => console.error(`[scheduler] ${l}`),
    })
    for (const f of r.fired) {
      await surface.send(f.userId, {
        text: `Scheduled buy ${f.status}${f.detail ? `: ${f.detail}` : ""}.`,
      })
    }
  } catch (err) {
    console.error("[scheduler] run failed", err)
  }
}
setInterval(runSchedules, 60_000)
void runSchedules()
console.error(`[bot] ${surface.kind} surface up · ${durable ? "supabase" : "memory"} stores`)
