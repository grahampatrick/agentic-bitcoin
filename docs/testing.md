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
pnpm --filter @agentic-bitcoin/rails demo:compute          # POSTs a one-line question to llm402.ai, ceiling 100 sats
L402_URL=https://other.example/v1/x L402_MAX_SATS=50 pnpm --filter @agentic-bitcoin/rails demo:compute
```

The demo refuses to pay if the 402 challenge asks for more than `L402_MAX_SATS`, and prints the
ledger entry (`paid N sats, HTTP 200`). The unit suite covers the full handshake against a local
402 server with the fake wallet, so `pnpm test` needs no network.
