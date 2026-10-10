/**
 * A scripted model for demos and tests: no API key, no network. It understands a handful of plain
 * requests with regexes, emits the same tool calls a real model would, and writes a short reply from
 * the tool result. Everything after the tool call — policy, executor, ledger, confirmation — is the
 * real thing; only the language understanding is canned. Labelled as such wherever it is used.
 */
import type { LlmClient, LlmContentBlock, LlmMessage, LlmResponse, LlmTool } from "./llm"

const COLD = /\b(bc1|tb1|bcrt1)[0-9a-z]{20,}\b|\b[13mn2][1-9A-HJ-NP-Za-km-z]{25,34}\b/i

function lastUserText(messages: LlmMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.role === "user" && typeof m.content === "string") return m.content
    if (m?.role === "user" && Array.isArray(m.content)) {
      const t = m.content.find((b) => b.type === "text") as { text?: string } | undefined
      if (t?.text) return t.text
      return null // tool results → we are in the "compose a reply" phase
    }
  }
  return null
}

function lastToolResult(
  messages: LlmMessage[],
): { name: string; result: Record<string, unknown> } | null {
  const last = messages.at(-1)
  if (!last || last.role !== "user" || !Array.isArray(last.content)) return null
  const tr = last.content.find((b) => b.type === "tool_result") as
    | { tool_use_id?: string; content?: unknown }
    | undefined
  if (!tr) return null
  const prev = messages.at(-2)
  let name = "tool"
  if (prev?.role === "assistant" && Array.isArray(prev.content)) {
    const use = prev.content.find(
      (b) => b.type === "tool_use" && (b as { id?: string }).id === tr.tool_use_id,
    ) as { name?: string } | undefined
    if (use?.name) name = use.name
  }
  try {
    return { name, result: JSON.parse(String(tr.content)) as Record<string, unknown> }
  } catch {
    return { name, result: {} }
  }
}

const num = (s: string) => Number.parseInt(s.replace(/[,_]/g, ""), 10)
const dollarsToCents = (s: string) => Math.round(Number.parseFloat(s.replace(/[,_]/g, "")) * 100) // money-ok: parsing a human's "$25" in a canned demo model

/** Map an utterance to a tool call. Returns null when nothing matches (the reply is then text). */
export function intentOf(text: string): { name: string; input: Record<string, unknown> } | null {
  const t = text.trim()
  const low = t.toLowerCase()
  if (/\b(balance|how (much|many) (sats|do i have))\b/.test(low))
    return { name: "get_balance", input: {} }

  const give =
    /^(?:give|tithe|donate|support|tip)\s+([\d,_]+)\s*sats?\s+to\s+(?:the\s+)?(.+?)(?:\s+(?:every|each)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|week|month))?(?:\s+for\s+(.+?))?\s*$/i.exec(
      t,
    )
  if (give && !/\S+@\S+/.test(give[2] ?? "")) {
    const amount = num(give[1] ?? "0")
    const slug = (give[2] ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
    const verb = low.split(/\s+/)[0] ?? ""
    const purpose =
      verb === "tithe"
        ? "tithe"
        : verb === "support" || /missionar/i.test(t)
          ? "support"
          : verb === "tip"
            ? "tip"
            : "gift"
    const when = give[3]?.toLowerCase()
    if (when) {
      const dow: Record<string, number> = {
        sunday: 0,
        monday: 1,
        tuesday: 2,
        wednesday: 3,
        thursday: 4,
        friday: 5,
        saturday: 6,
      }
      const cron =
        when === "month"
          ? "0 14 1 * *"
          : when === "week"
            ? "0 14 * * 1"
            : `0 14 * * ${dow[when] ?? 0}`
      return {
        name: "schedule_give",
        input: {
          recipient_slug: slug,
          amount_sats: amount,
          usd_cents: 0,
          cron,
          purpose,
          campaign_slug: "",
          supporter_name: "",
        },
      }
    }
    return {
      name: "give",
      input: {
        recipient_slug: slug,
        amount_sats: amount,
        purpose,
        note: give[4] ?? "",
        campaign_slug: "",
        supporter_name: "",
      },
    }
  }
  // "support the ortiz family $25 a month" → a dollar pledge, re-priced each time
  const pledge =
    /^(?:support|give(?: to)?|sponsor)\s+(?:the\s+)?(.+?)\s+(?:with\s+)?\$\s?([\d.,_]+)\s+(?:a|per|every|each)\s+(month|week)\s*$/i.exec(
      t,
    )
  if (pledge) {
    const slug = (pledge[1] ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
    return {
      name: "schedule_give",
      input: {
        recipient_slug: slug,
        amount_sats: 0,
        usd_cents: dollarsToCents(pledge[2] ?? "0"),
        cron: pledge[3]?.toLowerCase() === "week" ? "0 14 * * 1" : "0 14 1 * *",
        purpose: "support",
        campaign_slug: "",
        supporter_name: "",
      },
    }
  }
  if (
    /\b(pause|stop|cancel|list|show|what)\b.*\b(my\s+)?(support|pledges?|schedules?|recurring|subscriptions?)\b/i.test(
      t,
    ) &&
    !/sch_/.test(t)
  )
    return { name: "list_schedules", input: {} }
  const given = /\bhow much\s+(?:have|did)\s+i\s+(?:given|give|gave)\b(?:.*?\b(20\d\d)\b)?/i.exec(t)
  if (given) return { name: "giving_summary", input: { year: given[1] ? Number(given[1]) : 2026 } }
  if (
    /\b(find|which|what|show|list|search)\b.*\b(church|churches|missionar(?:y|ies)|recipients?|ministr(?:y|ies)|give to)\b/i.test(
      t,
    )
  ) {
    const query =
      /\b(church(?:es)?|missionar(?:y|ies)|ministr(?:y|ies))\b/i.exec(t)?.[1]?.toLowerCase() ?? ""
    return {
      name: "find_recipient",
      input: {
        query: query
          .replace(/churches/, "church")
          .replace(/missionaries/, "missionary")
          .replace(/ministries/, "ministry"),
      },
    }
  }
  const pay =
    /(?:pay|send|tip)\s+(?:([\d,_]+)\s*sats?\s+to\s+(\S+@\S+)|(\S+@\S+)\s+([\d,_]+)\s*sats?)/i.exec(
      t,
    )
  if (pay) {
    const amount = num(pay[1] ?? pay[4] ?? "0")
    const address = (pay[2] ?? pay[3] ?? "").replace(/[.,;:!?]+$/, "")
    const memo = /(?:for|memo:?|note:?)\s+["“]?([^"”]+?)["”]?\s*$/i.exec(t)?.[1] ?? ""
    return { name: "pay_lightning_address", input: { address, amount_sats: amount, memo } }
  }
  const inv = /(?:pay|settle)\s+(?:this\s+)?(?:invoice\s*:?\s*)?(lnbc[0-9a-z]+)/i.exec(t)
  if (inv) {
    const amt = /\(([\d,_]+)\s*sats?\)/i.exec(t)?.[1]
    return {
      name: "pay_invoice",
      input: { bolt11: inv[1], amount_sats: amt ? num(amt) : 1, destination: "" },
    }
  }
  const mk = /(?:invoice|receive|request)\b.*?([\d,_]+)\s*sats?/i.exec(t)
  if (mk && /invoice|receive|request/.test(low)) {
    const memo = /(?:for|memo:?)\s+(.+?)$/i.exec(t)?.[1] ?? "payment"
    return {
      name: "make_invoice",
      input: { amount_sats: num(mk[1] ?? "0"), memo: memo.slice(0, 60), expiry_seconds: 3600 },
    }
  }
  const dca =
    /\$\s?([\d.,_]+)\s+(?:of\s+bitcoin\s+)?(?:every|each)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|day)/i.exec(
      t,
    ) ??
    /(?:every|each)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|day)\b.*?\$\s?([\d.,_]+)/i.exec(
      t,
    )
  if (dca) {
    const firstIsAmount = /^[\d.]/.test(dca[1] ?? "")
    const a = firstIsAmount ? dca[1] : dca[2]
    const d = firstIsAmount ? dca[2] : dca[1]
    const dow: Record<string, number> = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    }
    const day = (d ?? "").toLowerCase()
    const cron =
      day === "day" ? "0 14 * * *" : day === "week" ? "0 14 * * 1" : `0 14 * * ${dow[day] ?? 5}`
    return {
      name: "schedule_buy",
      input: { exchange: "strike", usd_cents: dollarsToCents(a ?? "0"), cron },
    }
  }
  const buy =
    /buy\s+\$\s?([\d.,_]+)(?:\s+(?:of|worth of))?\s+(?:of\s+)?bitcoin|buy\s+([\d.,_]+)\s+dollars?\s+(?:of|worth of)\s+bitcoin/i.exec(
      t,
    )
  if (buy)
    return {
      name: "buy_bitcoin",
      input: { exchange: "strike", usd_cents: dollarsToCents(buy[1] ?? buy[2] ?? "0") },
    }
  const cancel = /cancel\s+(?:schedule\s+)?(sch_\S+)/i.exec(t)
  if (cancel) return { name: "cancel_schedule", input: { schedule_id: cancel[1] } }
  // storefront (M12): "find me a study bible" / "search the store for tees" / "buy dir:merchant:id ship to …"
  const buyDir =
    /\bbuy\s+(dir:[a-z0-9-]+:[a-z0-9-]+)\b(?:[^$]*?\$\s?([\d.,_]+))?(?:.*?\bship(?:ping)?\s+to\s+(.+?)\s*$)?/i.exec(
      t,
    )
  if (buyDir) {
    // buy_product (directory): the scripted model cannot look prices up; the rail rejects a wrong price.
    const ship = (buyDir[3] ?? "").split(/\s*,\s*/)
    const hasShip = ship.length >= 4
    return {
      name: "buy_product",
      input: {
        merchant: "directory",
        product_id: buyDir[1],
        description: buyDir[1],
        usd_cents: buyDir[2] ? dollarsToCents(buyDir[2]) : 0,
        ship_name: hasShip ? (ship[0] ?? "") : "",
        ship_address: hasShip ? (ship[1] ?? "") : "",
        ship_city: hasShip ? (ship[2] ?? "") : "",
        ship_region: hasShip && ship.length >= 6 ? (ship[3] ?? "") : "",
        ship_postal: hasShip && ship.length >= 6 ? (ship[4] ?? "") : "",
        ship_country: hasShip ? (ship[ship.length - 1] ?? "") : "",
        contact: "",
      },
    }
  }
  const findShop =
    /^(?:find|search(?: the store)?(?: for)?|look for|shop for|show me|do you have)\s+(?:me\s+)?(?:an?\s+|some\s+)?(.+?)\??$/i.exec(
      t,
    )
  if (
    findShop &&
    !/\b(church|churches|missionar|recipient|ministr|gift\s*card|top[- ]?up|esim|mint|amazon)\b/i.test(
      t,
    ) &&
    !/@/.test(t)
  ) {
    return { name: "search_products", input: { merchant: "directory", query: findShop[1] ?? "" } }
  }
  const goods =
    /\$\s?([\d.,_]+)\s+(amazon|gift\s*card|top[- ]?up|mint)/i.exec(t) ??
    /(amazon|gift\s*card|top[- ]?up|mint)[^$]*\$\s?([\d.,_]+)/i.exec(t)
  if (goods) {
    const firstIsAmount = /^[\d.]/.test(goods[1] ?? "")
    const amount = firstIsAmount ? goods[1] : goods[2]
    const what = firstIsAmount ? goods[2] : goods[1]
    const topup = /mint|top/i.test(what ?? "")
    return {
      name: "buy_product",
      input: {
        merchant: "bitrefill",
        product_id: topup ? "topup-mint-10" : "gift-amazon-us",
        description: `${topup ? "Mint Mobile top-up" : "Amazon.com gift card"} $${amount}`,
        ship_name: "",
        ship_address: "",
        ship_city: "",
        ship_region: "",
        ship_postal: "",
        ship_country: "",
        contact: "",
        usd_cents: dollarsToCents(amount ?? "0"),
      },
    }
  }
  if (/\b(search|find|what)\b.*\b(gift\s*cards?|products?|catalog)/i.test(t)) {
    return {
      name: "search_products",
      input: {
        merchant: "bitrefill",
        query: /amazon|mint|steam|uber/i.exec(t)?.[0]?.toLowerCase() ?? "gift card",
      },
    }
  }
  const l402 =
    /(?:fetch|get|call|ask)\s+(https:\/\/\S+).*?(?:up to|max|at most)\s+([\d,_]+)\s*sats?/i.exec(t)
  if (l402)
    return {
      name: "fetch_l402",
      input: { url: l402[1], max_sats: num(l402[2] ?? "0"), method: "GET", body: "" },
    }
  if (/\bsweep\b|\bcold\b/.test(low)) {
    const addr = COLD.exec(t)?.[0]
    if (addr) {
      const keep = /(?:above|keep(?:ing)?)\s+([\d,_]+)/i.exec(t)?.[1]
      const max = /max(?:imum)?\s+([\d,_]+)/i.exec(t)?.[1]
      const base = {
        address: addr,
        keep_sats: keep ? num(keep) : 0,
        max_sats: max ? num(max) : 1_000_000,
      }
      if (/monthly|every month/i.test(t))
        return { name: "schedule_sweep", input: { ...base, cron: "0 3 1 * *" } }
      return { name: "sweep_to_cold", input: base }
    }
  }
  return null
}

/** Compose the reply a careful assistant would give for a tool result. */
export function replyFor(name: string, r: Record<string, unknown>): string {
  const status = String(r.status ?? "")
  if (status === "awaiting_confirmation")
    return `${r.summary}\nReply yes to approve or no to cancel.`
  if (status === "denied")
    return `I can't do that: ${String(r.reason).replace(/_/g, " ").toLowerCase()} (${r.summary}). Your limits are set outside this chat with /budget.`
  if (status === "invalid_input") return `I couldn't do that: ${r.error}.`
  if (status === "failed") return `That didn't go through: ${r.error}.`
  if (status === "no_pending_action") return "There is nothing waiting for your approval."
  const result = (r.result ?? {}) as Record<string, unknown>
  switch (name) {
    case "get_balance":
      return `Your wallet holds ${Number(result.sats).toLocaleString("en-US")} sats.`
    case "pay_lightning_address":
    case "pay_invoice":
      return `Paid. ${r.summary}${result.preimage ? ` Preimage ${result.preimage}` : ""}`
    case "make_invoice":
      return `Here is an invoice for ${Number(result.amountSats).toLocaleString("en-US")} sats:\n${result.bolt11}`
    case "buy_bitcoin":
      return `Bought ${Number(result.sats).toLocaleString("en-US")} sats for $${(Number(result.usdCents) / 100).toFixed(2)}.` // money-ok: display in a canned demo model
    case "schedule_buy":
      return `Scheduled. Your recurring buy is ${result.scheduleId}; cancel it any time with “cancel ${result.scheduleId}”.`
    case "cancel_schedule":
      return "Cancelled."
    case "buy_product": {
      const order = (result.order ?? {}) as Record<string, unknown>
      return order.state === "delivered"
        ? "Delivered. I've sent you the code separately."
        : `Paid; the merchant reports “${order.state}”. I'll keep it in your ledger.`
    }
    case "search_products": {
      const products = (result.products ?? []) as {
        id: string
        name: string
        usdCents?: bigint | string | null
        url?: string
      }[]
      const strip = (x: string) => x.replace(/<\/?untrusted>/g, "")
      const price = (c: bigint | string | null | undefined) =>
        c === null || c === undefined ? "" : ` $${(Number(c) / 100).toFixed(2)}` // money-ok: display in a canned demo model
      return products.length
        ? `Found: ${products
            .slice(0, 5)
            .map((p) => `${strip(p.name)}${price(p.usdCents)} (${p.id})${p.url ? ` ${p.url}` : ""}`)
            .join(
              "; ",
            )}. Say “buy <id>” — physical goods need “ship to name, street, city, region, postal, country”.`
        : "Nothing matched."
    }
    case "fetch_l402":
      return `Fetched (HTTP ${result.status}). ${r.summary}`
    case "sweep_to_cold":
      return result.skipped
        ? "Nothing to sweep above the keep amount."
        : `Swept ${Number(result.amountSats).toLocaleString("en-US")} sats to cold storage. Transaction ${String(result.txid).slice(0, 12)}…`
    case "schedule_sweep":
      return `Scheduled a monthly sweep: ${result.scheduleId}.`
    case "give":
      return `Given. ${r.summary}${result.preimage ? ` Preimage ${result.preimage}` : ""}`
    case "schedule_give":
      return `Scheduled. Your recurring gift is ${result.scheduleId}; cancel it any time with “cancel ${result.scheduleId}”.`
    case "find_recipient": {
      const rs = (result.recipients ?? []) as {
        slug: string
        name: string
        kind: string
        verified: boolean
        campaigns?: { slug: string; title: string; goal: string }[]
      }[]
      const strip = (s: string) => s.replace(/<\/?untrusted>/g, "")
      return rs.length
        ? `You can give to: ${rs.map((x) => `${strip(x.name)} (${x.slug}, ${x.kind}${x.verified ? ", verified" : ""})${x.campaigns?.length ? ` — campaign: ${x.campaigns.map((c) => `${strip(c.title)} [${c.slug}], ${c.goal}`).join("; ")}` : ""}`).join("; ")}. Say e.g. “give 1000 sats to ${rs[0]?.slug}”.`
        : "No recipient matched. Add your own with /recipient add <name> <lightning address>."
    }
    case "list_schedules": {
      const ss = (result.schedules ?? []) as { id: string; summary: string; active: boolean }[]
      const live = ss.filter((s) => s.active)
      return live.length
        ? `Your recurring actions: ${live.map((s) => `${s.summary} (${s.id})`).join("; ")}. Cancel one with “cancel ${live[0]?.id}”.`
        : "You have no recurring actions."
    }
    case "giving_summary": {
      const by = (result.byRecipient ?? []) as {
        recipientName: string
        sats: bigint | string
        gifts: number
      }[]
      return by.length
        ? `In ${result.year} you gave ${Number(result.totalSats).toLocaleString("en-US")} sats in ${result.gifts} gifts: ${by.map((b) => `${b.recipientName} ${Number(b.sats).toLocaleString("en-US")} sats (${b.gifts})`).join("; ")}. /statement ${result.year} gives you the CSV.`
        : `No gifts recorded in ${result.year}.`
    }
    default:
      return `Done. ${r.summary ?? ""}`.trim()
  }
}

export class ScriptedLlmClient implements LlmClient {
  readonly kind = "scripted"
  private seq = 0
  async complete(req: {
    system: string
    messages: LlmMessage[]
    tools: LlmTool[]
  }): Promise<LlmResponse> {
    const tr = lastToolResult(req.messages)
    if (tr) {
      const text: LlmContentBlock = {
        type: "text",
        text: replyFor(tr.name, tr.result),
        citations: null,
      }
      return { stop_reason: "end_turn", content: [text] }
    }
    const text = lastUserText(req.messages) ?? ""
    if (
      /\b(should i|is it a good time|good time to|will (the )?price|going to go (up|down)|when should i)\b/i.test(
        text,
      )
    ) {
      const noAdvice: LlmContentBlock = {
        type: "text",
        text: "I don't give financial advice, and I don't comment on price. I execute what you decide: say an amount and I'll do it within your limits.",
        citations: null,
      }
      return { stop_reason: "end_turn", content: [noAdvice] }
    }
    const intent = intentOf(text)
    if (!intent || !req.tools.some((t) => t.name === intent.name)) {
      const help: LlmContentBlock = {
        type: "text",
        text: "I can check your balance, pay a lightning address or invoice, make an invoice, buy bitcoin once or on a schedule, buy a gift card, fetch a paid API, give to a church or missionary, or sweep to cold storage. Try: “pay 500 sats to gm@getalby.com” or “which churches can I give to?”.",
        citations: null,
      }
      return { stop_reason: "end_turn", content: [help] }
    }
    const use: LlmContentBlock = {
      type: "tool_use",
      id: `tu_scripted_${++this.seq}`,
      name: intent.name,
      input: intent.input,
    }
    return { stop_reason: "tool_use", content: [use] }
  }
}
