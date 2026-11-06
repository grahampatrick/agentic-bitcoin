/**
 * The film: two scripted conversations shown in a phone frame on /film, after the Stripe Link and
 * Claude Duet launch clips, with Anvard's rules in place of a balance. Pure data so it can be
 * tested (totals add up, nothing exceeds the card) and played back by any renderer.
 *
 * Money here is display-only: whole sats as numbers and a fixed cents figure per line, at the
 * sandbox rate (ADR-0007). Nothing in this file is executed against a wallet.
 */

export type Beat =
  | { kind: "you"; text: string }
  | { kind: "bot"; text: string }
  | { kind: "status"; text: string }
  | { kind: "card"; name: string; limitSats: number; usd: string }
  | { kind: "limit"; limitSats: number; usd: string }
  | { kind: "item"; emoji: string; text: string; sats: number; usd: string }
  | { kind: "close" }
  | {
      kind: "order"
      id: string
      merchant: string
      line: string
      sats: number
      usd: string
      state: "pending" | "approved"
    }
  | { kind: "approve"; id: string }
  | { kind: "sheet"; text: string }
  | { kind: "done" }

export interface Scene {
  slug: string
  title: string
  tagline: string
  theme: "light" | "dark"
  beats: readonly Beat[]
}

/** How long a beat holds the stage before the next one starts, in ms. */
export function holdFor(b: Beat): number {
  switch (b.kind) {
    case "you":
      return 700 + b.text.length * 28
    case "bot":
      return 900 + Math.min(2400, b.text.length * 22)
    case "status":
      return 1100
    case "card":
      return 2200
    case "limit":
      return 1200
    case "item":
      return 1500
    case "close":
      return 500
    case "order":
      return 1400
    case "approve":
      return 500
    case "sheet":
      return 1600
    case "done":
      return 0
  }
}

export const SUNDAY: Scene = {
  slug: "sunday",
  title: "Sunday",
  tagline: "Give it a card with a limit. It buys within it and stops at the line.",
  theme: "light",
  beats: [
    {
      kind: "you",
      text: "I'm having people over to watch football on Sunday. Can you buy everything I need while I'm at work?",
    },
    {
      kind: "bot",
      text: "Yes. Make me a card with a limit and I'll buy within it without asking again. Anything over the line waits for your yes.",
    },
    { kind: "card", name: "Sunday party", limitSats: 180_000, usd: "$150" },
    { kind: "limit", limitSats: 180_000, usd: "$150" },
    { kind: "item", emoji: "🥤", text: "Cookies, soda and water", sats: 27_170, usd: "$22.60" },
    {
      kind: "item",
      emoji: "🏈",
      text: "Football napkins, matching plates and cups, a field-green table cover and one balloon",
      sats: 52_890,
      usd: "$43.99",
    },
    {
      kind: "item",
      emoji: "🍕",
      text: "Two large pizzas, Sunday at 4pm",
      sats: 53_990,
      usd: "$44.90",
    },
    { kind: "close" },
    {
      kind: "bot",
      text: "Got it. I'll use the Sunday card and keep the total under 180,000 sats.",
    },
    {
      kind: "bot",
      text: "All set. 134,050 sats ($111.49) for your Sunday Night Football party. Three receipts are in your ledger and 45,950 sats are left on the card.",
    },
    { kind: "done" },
  ],
}

export const SAMPLES: Scene = {
  slug: "samples",
  title: "Samples",
  tagline: "It shops, it quotes, it waits for your yes on each one. Then it proves it.",
  theme: "dark",
  beats: [
    {
      kind: "you",
      text: "Find three Gengar singles under $40 with real demand for the shelf, get quotes from shops that take Lightning, and order the best two.",
    },
    { kind: "bot", text: "On it." },
    { kind: "status", text: "Searching Anvard shops" },
    { kind: "status", text: "Reading Cardboard Castle" },
    {
      kind: "order",
      id: "o1",
      merchant: "cardboardcastle.shop",
      line: "Gengar ex 228/197 × 1",
      sats: 38_470,
      usd: "$32.00",
      state: "pending",
    },
    {
      kind: "bot",
      text: "First pick is ready: Gengar ex 228/197 from Cardboard Castle, 38,470 sats ($32.00) with shipping. It's over your ask-first line, so I'll place it when you say yes. The Gengar VMAX is next.",
    },
    { kind: "you", text: "Yes, finish that one" },
    { kind: "sheet", text: "Spend approved" },
    { kind: "approve", id: "o1" },
    { kind: "status", text: "Reading Moat & Mantle" },
    {
      kind: "order",
      id: "o2",
      merchant: "moatandmantle.cards",
      line: "Gengar VMAX 020/073 × 1",
      sats: 41_480,
      usd: "$34.50",
      state: "pending",
    },
    {
      kind: "bot",
      text: "Second pick: Gengar VMAX 020/073 from Moat & Mantle, 41,480 sats ($34.50). Say yes to complete it.",
    },
    { kind: "you", text: "yes" },
    { kind: "sheet", text: "Spend approved" },
    { kind: "approve", id: "o2" },
    {
      kind: "bot",
      text: "Both ordered, 79,950 sats in all:\n• Gengar ex 228/197, Cardboard Castle, 38,470 sats, confirmation KFUE8. Provenance seal attached.\n• Gengar VMAX 020/073, Moat & Mantle, 41,480 sats, confirmation 535AT.\n\nI passed on the Gengar V alt art: both quotes came in over $40. Receipts and both seals are in your ledger.",
    },
    { kind: "done" },
  ],
}

export const SCENES: readonly Scene[] = [SUNDAY, SAMPLES]

/** Sats spent on the card in a scene, from its item beats. */
export function spentSats(s: Scene): number {
  return s.beats.reduce((n, b) => (b.kind === "item" ? n + b.sats : n), 0)
}

/** The card limit a scene sets, or null when it sets none. */
export function cardLimitSats(s: Scene): number | null {
  const c = s.beats.find((b) => b.kind === "card")
  return c && c.kind === "card" ? c.limitSats : null
}

/** Whole running time of a scene in ms, with the beats' holds. */
export function runtimeMs(s: Scene): number {
  return s.beats.reduce((n, b) => n + holdFor(b), 0)
}
