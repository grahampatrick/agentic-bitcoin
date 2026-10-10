/**
 * Tool definitions generated from the Action union — one source of truth for the agent loop
 * and the MCP server. Each tool maps 1:1 to an Action kind (plus `confirm_action`).
 *
 * Inputs are plain JSON (amounts as integer sats / cents). `toolToAction` validates against the
 * schema here (strict tools guarantee shape from the API, but MCP clients give no such guarantee)
 * and converts to the bigint-typed Action. The idempotency key is derived server-side.
 */
import {
  type Action,
  type Campaign,
  type Cents,
  GIVE_PURPOSES,
  type GivePurpose,
  type PriceSnapshot,
  type Recipient,
  type Sats,
  centsToSats,
  satsToCents,
} from "@agentic-bitcoin/core"

export type JsonSchema = {
  type: "object"
  properties: Record<
    string,
    { type: string; description: string; enum?: string[]; minimum?: number }
  >
  required: string[]
  additionalProperties: false
}

export interface ToolSpec {
  name: string
  description: string
  input_schema: JsonSchema
  strict: true
}

const int = (description: string, minimum = 1) => ({ type: "integer", description, minimum })
const str = (description: string) => ({ type: "string", description })

export const TOOLS: readonly ToolSpec[] = [
  {
    name: "get_balance",
    description: "Read the user's Lightning wallet balance in sats.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    name: "make_invoice",
    description: "Create a Lightning invoice (BOLT11) the user can share to receive sats.",
    input_schema: {
      type: "object",
      properties: {
        amount_sats: int("Amount to receive, whole sats"),
        memo: str("Short description shown to the payer"),
        expiry_seconds: int("Seconds until the invoice expires (default 3600)", 60),
      },
      required: ["amount_sats", "memo", "expiry_seconds"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "pay_invoice",
    description:
      "Pay a BOLT11 Lightning invoice the user provided. amount_sats must equal the invoice amount (or the amount for a zero-amount invoice).",
    input_schema: {
      type: "object",
      properties: {
        bolt11: str("The invoice string starting with lnbc"),
        amount_sats: int("Amount in whole sats"),
        destination: str("Payee name or host if known, else an empty string"),
      },
      required: ["bolt11", "amount_sats", "destination"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "pay_lightning_address",
    description: "Send sats to a lightning address like name@domain.com.",
    input_schema: {
      type: "object",
      properties: {
        address: str("Lightning address, name@domain"),
        amount_sats: int("Amount in whole sats"),
        memo: str("Optional note to the recipient, or an empty string"),
      },
      required: ["address", "amount_sats", "memo"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "buy_bitcoin",
    description: "Buy bitcoin once with US dollars on the user's own exchange account.",
    input_schema: {
      type: "object",
      properties: {
        exchange: {
          type: "string",
          description: "Which exchange account; use strike unless the user names another",
          enum: ["strike", "coinbase"],
        },
        usd_cents: int("Dollar amount in cents"),
      },
      required: ["exchange", "usd_cents"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "schedule_buy",
    description:
      "Create a recurring bitcoin buy (dollar-cost averaging). cron is a five-field UTC expression.",
    input_schema: {
      type: "object",
      properties: {
        exchange: {
          type: "string",
          description: "Which exchange account; use strike unless the user names another",
          enum: ["strike", "coinbase"],
        },
        usd_cents: int("Dollar amount per purchase, in cents"),
        cron: str("Five-field cron expression in UTC, e.g. '0 14 * * 5' for Fridays at 14:00"),
      },
      required: ["exchange", "usd_cents", "cron"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "cancel_schedule",
    description: "Cancel a recurring buy by its schedule id.",
    input_schema: {
      type: "object",
      properties: { schedule_id: str("The schedule id") },
      required: ["schedule_id"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "search_products",
    description:
      "Search a merchant's catalogue (gift cards, phone top-ups, eSIMs). Read-only; use it to find a product_id before buy_product.",
    input_schema: {
      type: "object",
      properties: {
        merchant: { type: "string", description: "Merchant", enum: ["bitrefill"] },
        query: str("Search words, e.g. 'amazon' or 'mint mobile'"),
      },
      required: ["merchant", "query"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "buy_product",
    description:
      "Buy a product (gift card, phone top-up, eSIM) from a merchant, paid in sats from the wallet. Always requires the user's confirmation.",
    input_schema: {
      type: "object",
      properties: {
        merchant: { type: "string", description: "Merchant", enum: ["bitrefill"] },
        product_id: str("Merchant product id"),
        description: str("Human description of the product, e.g. 'Amazon.com gift card $25'"),
        usd_cents: int("Price in cents"),
      },
      required: ["merchant", "product_id", "description", "usd_cents"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "fetch_l402",
    description:
      "Fetch an HTTP resource that charges a Lightning payment (L402 / HTTP 402). Pays up to max_sats.",
    input_schema: {
      type: "object",
      properties: {
        url: str("The https URL"),
        max_sats: int("Maximum sats you are allowed to pay for this request"),
        method: { type: "string", description: "HTTP method", enum: ["GET", "POST"] },
        body: str("JSON request body for POST, or an empty string for GET"),
      },
      required: ["url", "max_sats", "method", "body"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "sweep_to_cold",
    description:
      "Move on-chain balance above keep_sats to the user's registered cold-storage address (set with /cold). Always requires confirmation.",
    input_schema: {
      type: "object",
      properties: {
        address: str("The cold-storage bitcoin address the user registered"),
        keep_sats: int("How many sats to leave in the hot wallet", 0),
        max_sats: int("Ceiling for this sweep, in sats"),
      },
      required: ["address", "keep_sats", "max_sats"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "schedule_sweep",
    description:
      "Create a recurring sweep to cold storage (e.g. monthly). cron is a five-field UTC expression. Always requires confirmation.",
    input_schema: {
      type: "object",
      properties: {
        address: str("The cold-storage bitcoin address the user registered"),
        keep_sats: int("How many sats to leave in the hot wallet", 0),
        max_sats: int("Ceiling per run, in sats"),
        cron: str("Five-field cron in UTC, e.g. '0 3 1 * *' for the 1st of each month at 03:00"),
      },
      required: ["address", "keep_sats", "max_sats", "cron"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "find_recipient",
    description:
      "Search the giving directory (churches, missionaries, creators) and the user's private recipients. Read-only. Returns slugs, names, Lightning addresses and whether each is verified. Call it before give or schedule_give unless the user gave an exact slug.",
    input_schema: {
      type: "object",
      properties: {
        query: str(
          "Words from the name, kind (church, missionary), place or description; empty string lists all",
        ),
      },
      required: ["query"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "give",
    description:
      "Give sats once to a recipient by slug (from find_recipient). Only verified directory recipients or the user's own private recipients can receive; the policy decides.",
    input_schema: {
      type: "object",
      properties: {
        recipient_slug: str("The recipient's slug exactly as returned by find_recipient"),
        amount_sats: int("Amount in whole sats"),
        purpose: {
          type: "string",
          description: "What the gift is: tithe, offering, support (missionary), tip, or gift",
          enum: [...GIVE_PURPOSES],
        },
        note: str("Optional note to the recipient, or an empty string"),
        campaign_slug: str(
          "Campaign slug from find_recipient results when the gift supports a campaign, else an empty string",
        ),
        supporter_name: str(
          "First name the user chose to show the recipient, or an empty string (anonymous)",
        ),
      },
      required: [
        "recipient_slug",
        "amount_sats",
        "purpose",
        "note",
        "campaign_slug",
        "supporter_name",
      ],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "schedule_give",
    description:
      "Create a recurring gift to a recipient by slug. cron is a five-field UTC expression (e.g. '0 14 * * 0' every Sunday). Give usd_cents for a dollar amount re-priced each time, or amount_sats for a fixed sats amount (the other must be 0).",
    input_schema: {
      type: "object",
      properties: {
        recipient_slug: str("The recipient's slug exactly as returned by find_recipient"),
        amount_sats: int("Fixed sats per gift, or 0 when usd_cents is used", 0),
        usd_cents: int("Dollar amount per gift in cents, or 0 when amount_sats is used", 0),
        cron: str("Five-field cron expression in UTC"),
        purpose: {
          type: "string",
          description: "tithe, offering, support, tip, or gift",
          enum: [...GIVE_PURPOSES],
        },
        campaign_slug: str(
          "Campaign slug from find_recipient results when the pledge supports a campaign, else an empty string",
        ),
        supporter_name: str(
          "First name the user chose to show the recipient, or an empty string (anonymous)",
        ),
      },
      required: [
        "recipient_slug",
        "amount_sats",
        "usd_cents",
        "cron",
        "purpose",
        "campaign_slug",
        "supporter_name",
      ],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "list_schedules",
    description:
      "List the user's recurring actions (buys, sweeps, gifts and pledges) with their ids, so one can be cancelled with cancel_schedule. Read-only.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    name: "giving_summary",
    description:
      "How much the user has given in a year, in total and per recipient, from their own ledger. Read-only.",
    input_schema: {
      type: "object",
      properties: { year: int("Four-digit year, e.g. 2026", 2000) },
      required: ["year"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "confirm_action",
    description:
      "Execute an action the user has explicitly approved after seeing its summary. Only valid with an action_hash returned earlier in this conversation.",
    input_schema: {
      type: "object",
      properties: { action_hash: str("The action_hash from the awaiting_confirmation result") },
      required: ["action_hash"],
      additionalProperties: false,
    },
    strict: true,
  },
]

export const TOOL_BY_NAME: Record<string, ToolSpec> = Object.fromEntries(
  TOOLS.map((t) => [t.name, t]),
)

/**
 * The schema as the Claude API accepts it for strict tools: no `minimum` (rejected with
 * "For 'integer' type, property 'minimum' is not supported"). Our own `validateInput` still
 * enforces minimums before any action is built.
 */
export function apiSchema(schema: JsonSchema): JsonSchema {
  const properties: JsonSchema["properties"] = {}
  for (const [k, v] of Object.entries(schema.properties)) {
    const { minimum: _min, ...rest } = v
    properties[k] = rest
  }
  return { ...schema, properties }
}

export class ToolInputError extends Error {
  readonly code = "TOOL_INPUT"
  constructor(message: string) {
    super(message)
    this.name = "ToolInputError"
  }
}

/** Validate a JSON input against a tool's (deliberately simple) schema. */
export function validateInput(tool: ToolSpec, input: unknown): Record<string, string | number> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ToolInputError(`${tool.name}: input must be an object`)
  const obj = input as Record<string, unknown>
  const out: Record<string, string | number> = {}
  for (const key of Object.keys(obj)) {
    if (!(key in tool.input_schema.properties))
      throw new ToolInputError(`${tool.name}: unknown field ${key}`)
  }
  for (const [key, spec] of Object.entries(tool.input_schema.properties)) {
    const v = obj[key]
    const required = tool.input_schema.required.includes(key)
    if (v === undefined || v === null) {
      if (required) throw new ToolInputError(`${tool.name}: missing ${key}`)
      continue
    }
    if (spec.type === "integer") {
      if (typeof v !== "number" || !Number.isSafeInteger(v))
        throw new ToolInputError(`${tool.name}: ${key} must be an integer`)
      if (spec.minimum !== undefined && v < spec.minimum)
        throw new ToolInputError(`${tool.name}: ${key} must be ≥ ${spec.minimum}`)
      out[key] = v
    } else if (spec.type === "string") {
      if (typeof v !== "string") throw new ToolInputError(`${tool.name}: ${key} must be a string`)
      if (spec.enum && !spec.enum.includes(v))
        throw new ToolInputError(`${tool.name}: ${key} must be one of ${spec.enum.join(", ")}`)
      out[key] = v
    }
  }
  return out
}

export interface ToolContext {
  /** Unique per tool call; becomes the idempotency key. */
  callId: string
  requestedBy: Action["requestedBy"]
  /** Needed to size exchange and merchant actions in sats. */
  price?: PriceSnapshot
  /**
   * For give / schedule_give: the recipient resolved server-side from the slug, with whether this
   * user may give to it. `null` = no such recipient visible to the user; undefined = not looked up.
   */
  recipient?: { recipient: Recipient; trusted: boolean } | null
  /** For give / schedule_give with a campaign_slug: the campaign resolved server-side (null = not found). */
  campaign?: Campaign | null
}

/** Headroom over the quoted sats for merchant orders: 1% + 10 sats, so a fair quote fits under the cap. */
function withHeadroom(s: Sats): Sats {
  return s + s / 100n + 10n
}

/**
 * Convert a validated tool call into an Action. Returns null for `confirm_action`, which is not
 * an Action but a reference to a pending one.
 */
export function toolToAction(name: string, rawInput: unknown, ctx: ToolContext): Action | null {
  const tool = TOOL_BY_NAME[name]
  if (!tool) throw new ToolInputError(`unknown tool ${name}`)
  const input = validateInput(tool, rawInput)
  const base = { idempotencyKey: ctx.callId, requestedBy: ctx.requestedBy }
  const needPrice = (): PriceSnapshot => {
    if (!ctx.price)
      throw new ToolInputError(`${name}: a price is required to size this action in sats`)
    return ctx.price
  }
  switch (name) {
    case "get_balance":
      return { kind: "get_balance", ...base }
    case "make_invoice":
      return {
        kind: "make_invoice",
        ...base,
        amountSats: BigInt(input.amount_sats as number),
        memo: input.memo as string,
        expirySeconds: (input.expiry_seconds as number) ?? 3600,
      }
    case "pay_invoice":
      return {
        kind: "pay_invoice",
        ...base,
        bolt11: input.bolt11 as string,
        amountSats: BigInt(input.amount_sats as number),
        destination: (input.destination as string) || undefined,
      }
    case "pay_lightning_address":
      return {
        kind: "pay_address",
        ...base,
        address: input.address as string,
        amountSats: BigInt(input.amount_sats as number),
        memo: (input.memo as string) || undefined,
      }
    case "buy_bitcoin": {
      const usdCents: Cents = BigInt(input.usd_cents as number)
      return {
        kind: "buy_bitcoin",
        ...base,
        exchange: input.exchange as "strike" | "coinbase",
        usdCents,
        estimatedSats: centsToSats(usdCents, needPrice()),
      }
    }
    case "schedule_buy": {
      const usdCents: Cents = BigInt(input.usd_cents as number)
      return {
        kind: "schedule_buy",
        ...base,
        exchange: input.exchange as "strike" | "coinbase",
        usdCents,
        cron: input.cron as string,
        estimatedSats: centsToSats(usdCents, needPrice()),
      }
    }
    case "cancel_schedule":
      return { kind: "cancel_schedule", ...base, scheduleId: input.schedule_id as string }
    case "search_products":
      return {
        kind: "search_products",
        ...base,
        merchant: "bitrefill",
        query: input.query as string,
      }
    case "sweep_to_cold":
      return {
        kind: "sweep_to_cold",
        ...base,
        address: (input.address as string).trim(),
        keepSats: BigInt(input.keep_sats as number),
        maxSats: BigInt(input.max_sats as number),
      }
    case "schedule_sweep":
      return {
        kind: "schedule_sweep",
        ...base,
        address: (input.address as string).trim(),
        keepSats: BigInt(input.keep_sats as number),
        maxSats: BigInt(input.max_sats as number),
        cron: input.cron as string,
      }
    case "buy_product": {
      const usdCents: Cents = BigInt(input.usd_cents as number)
      return {
        kind: "buy_product",
        ...base,
        merchant: "bitrefill",
        productId: input.product_id as string,
        description: input.description as string,
        usdCents,
        amountSats: withHeadroom(centsToSats(usdCents, needPrice())),
      }
    }
    case "fetch_l402": {
      let host: string
      try {
        const u = new URL(input.url as string)
        if (u.protocol !== "https:") throw new Error()
        host = u.host.toLowerCase()
      } catch {
        throw new ToolInputError("fetch_l402: url must be https")
      }
      const method = (input.method as "GET" | "POST") ?? "GET"
      const body = (input.body as string) || undefined
      return {
        kind: "pay_l402",
        ...base,
        url: input.url as string,
        host,
        amountSats: BigInt(input.max_sats as number),
        method,
        body: method === "POST" ? body : undefined,
        headers: method === "POST" && body ? { "content-type": "application/json" } : undefined,
      }
    }
    case "find_recipient":
      return { kind: "find_recipient", ...base, query: (input.query as string) ?? "" }
    case "give":
    case "schedule_give": {
      const slug = String(input.recipient_slug ?? "").toLowerCase()
      if (ctx.recipient === undefined)
        throw new ToolInputError(`${name}: recipients are not available here`)
      if (ctx.recipient === null)
        throw new ToolInputError(
          `${name}: no recipient with slug "${slug}" is visible to this user; call find_recipient and use a slug from its results`,
        )
      const { recipient: r, trusted } = ctx.recipient
      if (r.slug !== slug)
        throw new ToolInputError(`${name}: resolved recipient does not match slug`)
      const purpose = input.purpose as GivePurpose
      if (!GIVE_PURPOSES.includes(purpose)) throw new ToolInputError(`${name}: bad purpose`)
      const campaignSlug = String(input.campaign_slug ?? "").toLowerCase() || undefined
      if (campaignSlug) {
        if (!ctx.campaign)
          throw new ToolInputError(
            `${name}: no campaign "${campaignSlug}" for this recipient; use a campaign slug from find_recipient`,
          )
        if (
          ctx.campaign.slug !== campaignSlug ||
          ctx.campaign.recipientSlug !== r.slug ||
          !ctx.campaign.active
        )
          throw new ToolInputError(
            `${name}: campaign "${campaignSlug}" does not belong to ${r.slug} or is closed`,
          )
      }
      const supporterName =
        String(input.supporter_name ?? "")
          .trim()
          .slice(0, 40) || undefined
      const common = {
        ...base,
        recipientSlug: r.slug,
        recipientName: r.name,
        address: r.lightningAddress,
        verified: trusted,
        purpose,
        campaignSlug,
        supporterName,
      }
      if (name === "give") {
        const amountSats: Sats = BigInt(input.amount_sats as number)
        return {
          kind: "give",
          ...common,
          amountSats,
          note: (input.note as string) || undefined,
          fiatCentsAtRequest: ctx.price ? satsToCents(amountSats, ctx.price) : undefined,
        }
      }
      const sats = BigInt((input.amount_sats as number) ?? 0)
      const cents: Cents = BigInt((input.usd_cents as number) ?? 0)
      if ((sats === 0n) === (cents === 0n))
        throw new ToolInputError("schedule_give: give exactly one of amount_sats or usd_cents")
      return {
        kind: "schedule_give",
        ...common,
        amountSats: sats > 0n ? sats : centsToSats(cents, needPrice()),
        usdCents: cents > 0n ? cents : undefined,
        cron: input.cron as string,
      }
    }
    case "list_schedules":
      return { kind: "list_schedules", ...base }
    case "giving_summary":
      return { kind: "giving_summary", ...base, year: input.year as number }
    case "confirm_action":
      return null
  }
  throw new ToolInputError(`unknown tool ${name}`)
}

/** Wrap text that came from outside (memos, product names, API bodies) so the model treats it as data. */
export function quoteUntrusted(text: string, maxLen = 2000): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
  const clean = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, maxLen)
  return `<untrusted>${clean.replace(/<\/?untrusted>/gi, "")}</untrusted>`
}
