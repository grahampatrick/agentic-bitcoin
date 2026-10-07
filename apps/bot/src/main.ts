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
import { NwcWalletRail, decryptSecret, parseKey } from "@agentic-bitcoin/rails"
import { Dispatcher } from "./dispatcher"
import {
  InMemoryHistoryStore,
  InMemoryPolicyStore,
  InMemorySecretStore,
  type LedgerStoreFactory,
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
const wallets = new Map<string, WalletRail>()
const secretsKey = env.SECRETS_KEY ? parseKey(env.SECRETS_KEY) : null
if (!durable) console.warn("[bot] no SUPABASE env — in-memory stores (non-durable)")
if (!env.NWC_URL) console.warn("[bot] NWC_URL not set — FAKE wallet, no real sats")

async function walletFor(userId: string): Promise<WalletRail> {
  const cached = wallets.get(userId)
  if (cached) return cached
  let rail: WalletRail
  const blob = secretsKey ? await secrets.get(userId, "nwc") : null
  if (blob && secretsKey)
    rail = new NwcWalletRail({ connectionString: decryptSecret(blob, secretsKey) })
  else if (env.NWC_URL) rail = new NwcWalletRail({ connectionString: env.NWC_URL })
  else rail = new FakeWalletRail()
  wallets.set(userId, rail)
  return rail
}

async function resolveContext(userId: string): Promise<UserContext> {
  return {
    userId,
    policy: (await policies.get(userId)) ?? DEFAULT_POLICY,
    ledger: ledgers.forUser(userId),
    rails: { wallet: await walletFor(userId) },
    pending,
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
})
await dispatcher.start()
console.error(`[bot] ${surface.kind} surface up · ${durable ? "supabase" : "memory"} stores`)
