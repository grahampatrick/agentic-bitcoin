/**
 * Shared fixtures — one truth for every test suite in the monorepo.
 *
 * Rules: deterministic, no secrets, no real credentials, nothing that could be mistaken for a
 * live key. Lightning strings here are SYNTHETIC (they start with `lnbc` so fakes accept them but
 * do not decode); M2 adds real regtest vectors alongside, never instead.
 *
 * This package has no runtime dependency on core: it uses structural types with bigint literals so
 * core's tests can import it without a cycle.
 */

export const NOW = "2026-10-07T12:00:00.000Z"
export const clockAt =
  (iso: string = NOW) =>
  () =>
    new Date(iso)

/** Price at fixture time: $83,169.00 per BTC → 1,202 sats per dollar. */
export const PRICE = {
  usdCentsPerBtc: 8_316_900n,
  asOf: NOW,
  source: "fixture",
} as const

export const ADDRESSES = {
  gm: "gm@getalby.com",
  friend: "friend@walletofsatoshi.com",
  scammer: "free-money@evil.example",
} as const

/**
 * A REAL, decodable mainnet BOLT11 from the BOLT11 spec test vectors (250,000 sats, no expiry).
 * Nobody holds its preimage, so it can never be paid; it exists to exercise decoders.
 */
export const SPEC_INVOICE = {
  bolt11:
    "lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp",
  amountSats: 250_000n,
  paymentHash: "0001020304050607080900010203040506070809000102030405060708090102",
} as const

/** Synthetic BOLT11s. Fakes pay anything starting with lnbc; `fail`/`nofunds` trigger errors. */
export const INVOICES = {
  small: { bolt11: "lnbc210n1fixturesmall", amountSats: 21n, paymentHash: `${"0".repeat(63)}1` },
  medium: {
    bolt11: "lnbc100u1fixturemedium",
    amountSats: 10_000n,
    paymentHash: `${"0".repeat(63)}2`,
  },
  large: { bolt11: "lnbc1m1fixturelarge", amountSats: 100_000n, paymentHash: `${"0".repeat(63)}3` },
  failing: { bolt11: "lnbc210n1fixturefail", amountSats: 21n, paymentHash: `${"0".repeat(63)}4` },
  noFunds: {
    bolt11: "lnbc5m1fixturenofunds",
    amountSats: 500_000n,
    paymentHash: `${"0".repeat(63)}5`,
  },
} as const

/** The L402 challenge header shape (Lightning Labs spec): `WWW-Authenticate: L402 macaroon="…", invoice="…"`. */
export const L402 = {
  host: "llm402.ai",
  url: "https://llm402.ai/v1/chat/completions",
  header: 'L402 macaroon="AgEEbHNhdAJCAADFixture", invoice="lnbc100n1fixturel402"',
  macaroon: "AgEEbHNhdAJCAADFixture",
  invoice: "lnbc100n1fixturel402",
  amountSats: 10n,
  /** A challenge whose invoice really decodes (to 250,000 sats): for adapter tests. */
  decodableHeader: `L402 macaroon="AgEEbHNhdAJCAADFixture", invoice="${SPEC_INVOICE.bolt11}"`,
  /** The retry header once paid: `Authorization: L402 <macaroon>:<preimage>` */
  authorization: (macaroon: string, preimage: string) => `L402 ${macaroon}:${preimage}`,
} as const

/** Strike exchange quote (shape from docs.strike.me "exchanging currencies"; verify at M5). */
export const STRIKE_QUOTE = {
  id: "6b1f3b2e-fixture-4c1e-9a1b-strikequote01",
  state: "NEW",
  source: { amount: "5.00", currency: "USD" },
  target: { amount: "0.00006012", currency: "BTC" },
  conversionRate: { amount: "0.00001202", sourceCurrency: "USD", targetCurrency: "BTC" },
  created: NOW,
  validUntil: "2026-10-07T12:00:15.000Z",
} as const

/** Bitrefill invoice/order (shape approximate; OQ-9 says read docs.bitrefill.com before M6). */
export const BITREFILL_INVOICE = {
  id: "inv_fixture_bitrefill_01",
  status: "unpaid",
  paymentMethod: "lightning",
  payment: { lightningInvoice: "lnbc601k1fixturebitrefill", satoshiPrice: 60_120 },
  orders: [
    {
      id: "ord_fixture_01",
      productId: "amazon-com-us",
      value: 50,
      currency: "USD",
      status: "pending",
    },
  ],
} as const

/** Policies. */
export const POLICIES = {
  open: {
    dailyCapSats: 1_000_000n,
    perActionCapSats: 500_000n,
    confirmAboveSats: 1_000_000n,
    allowDestinations: [] as string[],
    denyDestinations: [] as string[],
    killSwitch: false,
    rails: { wallet: true, exchange: true, goods: true, compute: true },
  },
  strict: {
    dailyCapSats: 50_000n,
    perActionCapSats: 20_000n,
    confirmAboveSats: 5_000n,
    allowDestinations: ["*@getalby.com", "llm402.ai", "bitrefill", "strike"] as string[],
    denyDestinations: ["*.evil.example"] as string[],
    killSwitch: false,
    rails: { wallet: true, exchange: true, goods: true, compute: true },
  },
  killed: {
    dailyCapSats: 1_000_000n,
    perActionCapSats: 500_000n,
    confirmAboveSats: 1_000_000n,
    allowDestinations: [] as string[],
    denyDestinations: [] as string[],
    killSwitch: true,
    rails: { wallet: true, exchange: true, goods: true, compute: true },
  },
} as const

/** Canonical actions, one per kind. */
export const ACTIONS = {
  balance: { kind: "get_balance", idempotencyKey: "k-balance", requestedBy: "user" },
  invoice: {
    kind: "make_invoice",
    idempotencyKey: "k-invoice",
    requestedBy: "user",
    amountSats: 1_000n,
    memo: "coffee",
    expirySeconds: 3600,
  },
  tip: {
    kind: "pay_address",
    idempotencyKey: "k-tip-1",
    requestedBy: "user",
    address: ADDRESSES.gm,
    amountSats: 21n,
    memo: "thanks",
  },
  payFriend: {
    kind: "pay_address",
    idempotencyKey: "k-friend-1",
    requestedBy: "user",
    address: ADDRESSES.friend,
    amountSats: 15_000n,
  },
  payScammer: {
    kind: "pay_address",
    idempotencyKey: "k-scam-1",
    requestedBy: "agent",
    address: ADDRESSES.scammer,
    amountSats: 100n,
  },
  payInvoice: {
    kind: "pay_invoice",
    idempotencyKey: "k-inv-1",
    requestedBy: "user",
    bolt11: INVOICES.medium.bolt11,
    amountSats: INVOICES.medium.amountSats,
  },
  payFailing: {
    kind: "pay_invoice",
    idempotencyKey: "k-inv-fail",
    requestedBy: "user",
    bolt11: INVOICES.failing.bolt11,
    amountSats: INVOICES.failing.amountSats,
  },
  dca: {
    kind: "buy_bitcoin",
    idempotencyKey: "k-dca-1",
    requestedBy: "schedule",
    exchange: "strike",
    usdCents: 25_00n,
    estimatedSats: 30_050n,
  },
  schedule: {
    kind: "schedule_buy",
    idempotencyKey: "k-sched-1",
    requestedBy: "user",
    exchange: "strike",
    usdCents: 25_00n,
    cron: "0 14 * * 5",
    estimatedSats: 30_050n,
  },
  cancel: {
    kind: "cancel_schedule",
    idempotencyKey: "k-cancel-1",
    requestedBy: "user",
    scheduleId: "sch_1",
  },
  giftCard: {
    kind: "buy_product",
    idempotencyKey: "k-gift-1",
    requestedBy: "user",
    merchant: "bitrefill",
    productId: "gift-amazon-us",
    description: "Amazon.com gift card $10",
    usdCents: 10_00n,
    amountSats: 12_100n,
  },
  compute: {
    kind: "pay_l402",
    idempotencyKey: "k-l402-1",
    requestedBy: "agent",
    url: L402.url,
    host: L402.host,
    amountSats: 50n,
  },
} as const
