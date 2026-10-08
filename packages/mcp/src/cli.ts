import { randomUUID } from "node:crypto"
/**
 * agentic-bitcoin-mcp — stdio by default, `--http <port>` for Streamable HTTP.
 *
 * Env: NWC_URL (wallet; omit for the fake wallet in dev), SECRETS_KEY (unused until a store is
 * wired), POLICY_JSON (optional override of DEFAULT_POLICY), PRICE_URL (defaults to mempool.space).
 */
import { createServer as createHttpServer } from "node:http"
import { InMemoryPendingStore, type UserContext } from "@agentic-bitcoin/agent"
import {
  DEFAULT_POLICY,
  FakeWalletRail,
  InMemoryLedgerStore,
  type Policy,
  type PriceSnapshot,
} from "@agentic-bitcoin/core"
import { BitrefillGoodsRail, NwcWalletRail, StrikeExchangeRail } from "@agentic-bitcoin/rails"
import { InMemoryScheduleStore, schedulesHook } from "@agentic-bitcoin/scheduler"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { createServer } from "./server.js"

function parsePolicy(json: string | undefined): Policy {
  if (!json) return DEFAULT_POLICY
  const raw = JSON.parse(json, (_k, v) =>
    typeof v === "string" && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v,
  )
  return { ...DEFAULT_POLICY, ...raw }
}

async function fetchPrice(): Promise<PriceSnapshot | undefined> {
  try {
    const res = await fetch(process.env.PRICE_URL ?? "https://mempool.space/api/v1/prices", {
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

const ctx: UserContext = {
  userId: process.env.AB_USER_ID ?? "mcp-local",
  policy: parsePolicy(process.env.POLICY_JSON),
  ledger: new InMemoryLedgerStore(),
  rails: {
    wallet: process.env.NWC_URL
      ? new NwcWalletRail({ connectionString: process.env.NWC_URL })
      : new FakeWalletRail(),
    exchange: process.env.STRIKE_API_KEY
      ? new StrikeExchangeRail({ apiKey: process.env.STRIKE_API_KEY })
      : undefined,
    goods: process.env.BITREFILL_API_KEY
      ? new BitrefillGoodsRail({ apiKey: process.env.BITREFILL_API_KEY })
      : undefined,
  },
  pending: new InMemoryPendingStore(),
  // schedules are created through policy; firing them needs the bot/worker runner (ADR-0010)
  schedules: schedulesHook(new InMemoryScheduleStore()),
}
if (!process.env.NWC_URL)
  console.error("[agentic-bitcoin-mcp] NWC_URL not set — using the FAKE wallet (no real sats)")

const server = createServer({ resolveContext: async () => ctx, price: fetchPrice })

const httpIdx = process.argv.indexOf("--http")
if (httpIdx === -1) {
  await server.connect(new StdioServerTransport())
} else {
  const port = Number(process.argv[httpIdx + 1] ?? 3901)
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() })
  await server.connect(transport)
  createHttpServer((req, res) => {
    if (req.url?.startsWith("/mcp")) void transport.handleRequest(req, res)
    else {
      res.statusCode = 404
      res.end()
    }
  }).listen(port, () =>
    console.error(`[agentic-bitcoin-mcp] Streamable HTTP on http://localhost:${port}/mcp`),
  )
}
