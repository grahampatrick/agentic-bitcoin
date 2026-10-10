/**
 * Onboarding logic, pure where possible: wallet pairing (budgeted only), the first-run policy
 * wizard, and self-serve API-key entry. The dispatcher calls these; tests inject probes.
 */
import { DEFAULT_POLICY, type Policy, type Sats, formatSats } from "@agentic-bitcoin/core"

// --- wallet pairing ---------------------------------------------------------------------------

export interface WalletProbe {
  alias?: string
  network?: string
  methods?: string[]
  budget?: { usedSats: Sats; totalSats: Sats; renewal: string } | null
}

export type PairResult =
  | { ok: true; description: string }
  | { ok: false; error: string; unbudgeted?: boolean }

const REQUIRED_METHODS = ["get_balance", "make_invoice", "pay_invoice", "lookup_invoice"]

/**
 * Decide whether a connection may be paired. Refuses strings without a budget unless the user
 * explicitly overrides (`/pair unbudgeted <url>`), and strings missing the methods we need.
 */
export function assessPairing(probe: WalletProbe, opts: { allowUnbudgeted: boolean }): PairResult {
  const missing = probe.methods ? REQUIRED_METHODS.filter((m) => !probe.methods?.includes(m)) : []
  if (missing.length)
    return {
      ok: false,
      error: `This connection cannot ${missing.join(", ")}. Create one with those permissions.`,
    }
  if (probe.budget === null && !opts.allowUnbudgeted) {
    return {
      ok: false,
      unbudgeted: true,
      error:
        "This connection has NO budget: the wallet would let me spend everything in it. Create a new connection with a daily budget and an expiry (Alby Hub: Apps → Add connection → Budget), then /pair again. If you really want this one, send: /pair unbudgeted <string>",
    }
  }
  const b = probe.budget
  const budgetLine = b
    ? `Wallet budget ${formatSats(b.totalSats)} ${b.renewal} (${formatSats(b.usedSats)} used).`
    : b === null
      ? "Wallet budget: NONE (you overrode the check)."
      : "This wallet does not report its budget, so I could not verify one: make sure you set a budget in the wallet app."
  return {
    ok: true,
    description: `Paired ${probe.alias ?? "your wallet"}${probe.network ? ` on ${probe.network}` : ""}. ${budgetLine}`,
  }
}

/** Does this text look like a wallet connection string or an API key? Never let it reach the model. */
export function looksLikeSecret(text: string): boolean {
  return (
    /nostr\+walletconnect:\/\//i.test(text) ||
    /\bsecret=[0-9a-f]{32,}/i.test(text) ||
    /\b(sk|pk|key)[-_][A-Za-z0-9]{20,}/.test(text) ||
    /\b[A-Za-z0-9]{40,}\b/.test(text)
  )
}

export const PAIR_HELP = [
  "To pair your wallet, send: /pair <nostr+walletconnect://…>",
  "Get a connection string with a BUDGET and an EXPIRY:",
  "• Alby Hub: Apps → Add connection → name it, set a daily budget (e.g. 20,000 sats), expiry 30 days → copy.",
  "• Coinos: Settings → Nostr Wallet Connect → create with a limit.",
  "• Primal / Zeus: Wallet → Nostr Wallet Connect → new connection with a budget.",
  "I only accept budgeted strings. Delete the message after pairing; on Telegram I delete it for you.",
].join("\n")

// --- first-run policy wizard ------------------------------------------------------------------

export type WizardStep = "daily" | "confirm" | "rails"
export interface WizardState {
  step: WizardStep
  draft: Policy
}

export function startWizard(base: Policy = DEFAULT_POLICY): { state: WizardState; prompt: string } {
  return {
    state: { step: "daily", draft: { ...base } },
    prompt:
      "Let's set your limits (you can change them later with /budget).\n1/3 — How many sats may I spend per day in total? Reply with a number, e.g. 20000.",
  }
}

export function wizardStep(
  state: WizardState,
  input: string,
): { state: WizardState | null; prompt: string; policy?: Policy } {
  const t = input.trim().toLowerCase()
  switch (state.step) {
    case "daily": {
      const n = parseSats(t)
      if (n === null) return { state, prompt: "A whole number of sats, please (e.g. 20000)." }
      const draft = {
        ...state.draft,
        dailyCapSats: n,
        perActionCapSats: n < state.draft.perActionCapSats ? n : state.draft.perActionCapSats,
      }
      return {
        state: { step: "confirm", draft },
        prompt:
          "2/3 — Above how many sats should I ask you before paying? Reply with a number (0 = always ask), e.g. 5000.",
      }
    }
    case "confirm": {
      const n = parseSats(t)
      if (n === null) return { state, prompt: "A whole number of sats, please (0 = always ask)." }
      return {
        state: { step: "rails", draft: { ...state.draft, confirmAboveSats: n } },
        prompt:
          "3/3 — Which should I be able to do? Reply with any of: wallet, exchange, goods, compute — or 'all' or 'wallet only'.",
      }
    }
    case "rails": {
      const want =
        t === "all"
          ? ["wallet", "exchange", "goods", "compute"]
          : t
              .replace(/\bonly\b/g, "")
              .split(/[\s,]+/)
              .filter(Boolean)
      const known = ["wallet", "exchange", "goods", "compute"]
      const bad = want.filter((w) => !known.includes(w))
      if (!want.length || bad.length)
        return { state, prompt: `Choose from: wallet, exchange, goods, compute (or 'all').` }
      const rails = {
        wallet: want.includes("wallet"),
        exchange: want.includes("exchange"),
        goods: want.includes("goods"),
        compute: want.includes("compute"),
        onchain: state.draft.rails.onchain,
      }
      const policy = { ...state.draft, rails }
      return {
        state: null,
        policy,
        prompt: "Done. Your limits are set. Next: /pair your wallet, then just text me.",
      }
    }
  }
}

function parseSats(t: string): Sats | null {
  const m = /^(\d{1,12})(?:\s*sats?)?$/.exec(t.replace(/[,_]/g, ""))
  return m ? BigInt(m[1] as string) : null
}

// --- API keys --------------------------------------------------------------------------------

export type KeyName = "strike" | "bitrefill"
export const KEY_NAMES: KeyName[] = ["strike", "bitrefill"]

export type KeyCommand =
  | { kind: "show" }
  | { kind: "set"; name: KeyName; value: string }
  | { kind: "remove"; name: KeyName }
  | { kind: "error"; error: string }

export function parseKeyCommand(args: string[]): KeyCommand {
  const [name, value] = args
  if (!name) return { kind: "show" }
  if (!KEY_NAMES.includes(name.toLowerCase() as KeyName))
    return {
      kind: "error",
      error: "Usage: /key <strike|bitrefill> <api-key>  ·  /key <name> remove  ·  /key",
    }
  const n = name.toLowerCase() as KeyName
  if (!value) return { kind: "error", error: `Usage: /key ${n} <api-key>` }
  if (value.toLowerCase() === "remove") return { kind: "remove", name: n }
  if (value.length < 16) return { kind: "error", error: "That does not look like an API key." }
  return { kind: "set", name: n, value }
}

export const KEY_HELP = [
  "Strike (buy bitcoin): create a key at strike.me → Developer with ONLY these scopes: currency-exchange quote create + execute, rates, balances. Then: /key strike <key>",
  "Bitrefill (gift cards, top-ups): bitrefill.com/account/developers → Personal API key. Then: /key bitrefill <key>",
  "Keys are encrypted with a server key and shown masked. Remove any time: /key strike remove",
].join("\n")
