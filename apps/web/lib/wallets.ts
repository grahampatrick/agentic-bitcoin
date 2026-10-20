/**
 * Wallet deep links (M15). `lightning:` is the floor every Lightning wallet registers for; the
 * per-wallet schemes below are what each app documents or is widely reported to open. `verified`
 * flips to true only after a real-phone test recorded in docs/wallets.md (OQ-19).
 */
export interface WalletLink {
  id: string
  name: string
  /** Build the URL that opens this wallet with the invoice loaded. */
  url(bolt11: string): string
  verified: boolean
  platforms: ("ios" | "android" | "desktop")[]
}

const upper = (pr: string) => pr.toUpperCase()

export const WALLETS: readonly WalletLink[] = [
  {
    id: "generic",
    name: "Open in your wallet",
    url: (pr) => `lightning:${upper(pr)}`,
    verified: true,
    platforms: ["ios", "android", "desktop"],
  },
  {
    id: "strike",
    name: "Strike",
    url: (pr) => `lightning:${upper(pr)}`,
    verified: false,
    platforms: ["ios", "android"],
  },
  {
    id: "cashapp",
    name: "Cash App",
    url: (pr) => `lightning:${upper(pr)}`,
    verified: false,
    platforms: ["ios", "android"],
  },
  {
    id: "zeus",
    name: "Zeus",
    url: (pr) => `zeusln:lightning:${upper(pr)}`,
    verified: false,
    platforms: ["ios", "android"],
  },
  {
    id: "phoenix",
    name: "Phoenix",
    url: (pr) => `phoenix:lightning:${upper(pr)}`,
    verified: false,
    platforms: ["ios", "android"],
  },
  {
    id: "walletofsatoshi",
    name: "Wallet of Satoshi",
    url: (pr) => `walletofsatoshi:lightning:${upper(pr)}`,
    verified: false,
    platforms: ["ios", "android"],
  },
  {
    id: "blixt",
    name: "Blixt",
    url: (pr) => `blixtwallet:lightning:${upper(pr)}`,
    verified: false,
    platforms: ["ios", "android"],
  },
  {
    id: "breez",
    name: "Breez",
    url: (pr) => `breez:lightning:${upper(pr)}`,
    verified: false,
    platforms: ["ios", "android"],
  },
  {
    id: "muun",
    name: "Muun",
    url: (pr) => `muun:${upper(pr)}`,
    verified: false,
    platforms: ["ios", "android"],
  },
]

export function walletById(id: string): WalletLink | undefined {
  return WALLETS.find((w) => w.id === id)
}

export function isMobileUserAgent(ua: string): boolean {
  return /iphone|ipad|ipod|android|mobile/i.test(ua)
}

/**
 * Best effort: are we inside a wallet's in-app browser? Few wallets announce themselves; when one
 * does, the host wallet should get the Pay action directly.
 */
export function hostWalletFromUserAgent(ua: string): string | null {
  const u = ua.toLowerCase()
  if (u.includes("strike")) return "strike"
  if (u.includes("cashapp") || u.includes("cash app")) return "cashapp"
  if (u.includes("zeus")) return "zeus"
  if (u.includes("alby")) return "alby"
  return null
}
