/**
 * The landing-page copy, with the Bitcoin whitepaper phrases kept verbatim and in one place so
 * `copy.test.ts` can guard against drift. Everything not in WHITEPAPER is ours.
 *
 * Source: Satoshi Nakamoto, "Bitcoin: A Peer-to-Peer Electronic Cash System" (2008).
 */

export const WHITEPAPER = {
  p2p: "sent directly from one party to another without going through a financial institution",
  proof: "cryptographic proof instead of trust",
  parties: "any two willing parties",
  casual: "small casual transactions",
  simplicity: "The network is robust in its unstructured simplicity.",
} as const

export type Task = { readonly text: string; readonly icon: TaskIcon }
export type TaskIcon = "bitcoin" | "bolt" | "cart" | "chip" | "handshake"

/** The five underlined examples. Order matters: it mirrors the rails (wallet, exchange, goods, compute, on-chain). */
export const TASKS: readonly Task[] = [
  { text: "buy bitcoin every Friday", icon: "bitcoin" },
  { text: "pay a Lightning invoice", icon: "bolt" },
  { text: "order groceries in sats", icon: "cart" },
  { text: "rent GPU time by the second", icon: "chip" },
  { text: "settle a bill with a friend", icon: "handshake" },
]

export const COPY = {
  name: "Agentic Bitcoin",
  title: "Agentic Bitcoin",
  description:
    "Agentic Bitcoin is an assistant that holds, sends, and spends your bitcoin over Lightning — non-custodially, from a text message.",
  /** Beat 1, rendered bold. */
  headline: {
    before:
      "Agentic Bitcoin is an assistant that holds, sends, and spends your bitcoin the way it was designed to work: ",
    quote: WHITEPAPER.p2p,
    after: ".",
  },
  /** Beat 2. */
  interface: {
    a: "The interface is simple: there are no new interfaces. You text it. It acts on ",
    quoteA: WHITEPAPER.proof,
    b: ", and it can transact with ",
    quoteB: WHITEPAPER.parties,
    c: " over Lightning.",
  },
  /** Beat 3, before the task list. */
  examplesLead: "It can help you ",
  cta: "Text Agentic Bitcoin",
  footer: {
    copyright: `Copyright © ${new Date().getFullYear()} Agentic Bitcoin`,
    privacy: "Privacy policy",
    terms: "Terms of service",
    source: "Source",
    demo: "Try the sandbox",
    give: "Give",
    receive: "Receive",
    sourceUrl: "https://github.com/grahampatrick/agentic-bitcoin",
    note: "Phrases from the Bitcoin whitepaper, 2008. Not financial advice. Non-custodial.",
  },
} as const

/** Everything a reader sees on the home page, flattened — used by the quote-drift test. */
export function homeCopyAsText(): string {
  const h = COPY.headline
  const i = COPY.interface
  return [
    h.before + h.quote + h.after,
    i.a + i.quoteA + i.b + i.quoteB + i.c,
    COPY.examplesLead + TASKS.map((t) => t.text).join(", "),
    COPY.cta,
    COPY.footer.note,
  ].join("\n")
}
