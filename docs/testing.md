# Testing against a real wallet (M2)

Everything in `pnpm test` runs on fakes with no network. The NWC adapter additionally runs the
contract suite against a **real wallet on a test network** when you opt in.

## Get a budgeted NWC connection string

Any of these work. Use signet/mutinynet or a small mainnet budget — never an unlimited string.

1. **Alby Hub** (self-hosted; on the Start9 or `getalby.com/hub`): *Apps → Add connection* → name
   `agentic-bitcoin-test`, budget e.g. 10,000 sats / daily, expiry 7 days → copy the
   `nostr+walletconnect://…` string. Check *Permissions* include `get_balance`, `make_invoice`,
   `pay_invoice`, `lookup_invoice`.
2. **Coinos** (custodial, zero setup, fine for tests): Settings → Nostr Wallet Connect → create.
3. **LNbits** with the NWC extension on a Polar regtest node: enable the extension on a wallet, create a
   connection with a budget.

## Run

```bash
export NWC_URL='nostr+walletconnect://…'           # never commit; .env* is git-ignored
export NWC_TEST_ADDRESS='gm@getalby.com'            # an address that can receive 21 sats
pnpm --filter @agentic-bitcoin/rails test:wallet    # contract suite (pays 21 sats a few times)
pnpm --filter @agentic-bitcoin/rails demo:pay       # policy → ledger → NWC, prints preimage
```

The live suite is skipped unless `RUN_WALLET_CONTRACT=1` **and** `NWC_URL` are set, so CI never
touches money.

## What the demo checks before paying
- the connection string parses and has a relay and a secret (it is never printed);
- the wallet reports a **budget**; if it is unlimited the demo warns loudly;
- the invoice decodes to exactly the approved amount.

## Compute rail (M4): buy inference with sats

```bash
export NWC_URL='nostr+walletconnect://…'
L402_URL=https://<l402-endpoint> L402_MAX_SATS=50 pnpm --filter @agentic-bitcoin/rails demo:compute   # POSTs a one-line question, ceiling in sats
# L402_URL is required. llm402.ai (named in early research) does not resolve; LightningProx (lightningprox.com) or an Aperture route works.
```

The demo refuses to pay if the 402 challenge asks for more than `L402_MAX_SATS`, and prints the
ledger entry (`paid N sats, HTTP 200`). The unit suite covers the full handshake against a local
402 server with the fake wallet, so `pnpm test` needs no network.

## Exchange rail and scheduler (M5)

```bash
STRIKE_API_KEY=… pnpm --filter @agentic-bitcoin/rails demo:dca        # one $5 buy on your own Strike account
pnpm --filter @agentic-bitcoin/scheduler worker                       # no creds: "$1 every minute" on fakes, fires twice, cancels
```

The Strike key needs the currency-exchange quote create/execute, rates and balances scopes. Add the
Lightning payment-quote scopes ONLY if you turn on the sweep (`SWEEP_TO_WALLET=1` in the bot).

## Goods rail (M6): buy a product with sats

```bash
BITREFILL_API_KEY=… NWC_URL=… SECRETS_KEY=… pnpm --filter @agentic-bitcoin/rails demo:goods
GOODS_QUERY=mint GOODS_USD_CENTS=500 … demo:goods     # smallest sensible top-up
```

Bitrefill's no-charge test products need a Business key, so the Personal-key demo buys a real
$5 item. The demo prints the confirmation summary, waits 5 s, pays, polls until delivered, and
prints a masked code. With `SECRETS_KEY` the code is sealed into the ledger entry; without it,
nothing about the code is stored.

## On-chain sweep (M8)

Needs an LND node reachable over REST and a macaroon baked for on-chain only:

```bash
lncli bakemacaroon onchain:read onchain:write --save_to onchain.macaroon
export LND_REST_URL=https://your-node:8080 LND_MACAROON_HEX=$(xxd -p onchain.macaroon | tr -d '\n')
```

In chat: `/cold <address from your hardware wallet>` → `/budget rail onchain on` → “sweep everything above
200000 sats to cold storage” → confirm → `/ledger` shows the txid. “sweep monthly” creates a schedule.
