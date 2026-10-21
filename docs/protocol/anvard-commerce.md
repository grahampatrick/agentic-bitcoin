# Anvard commerce protocol, v0.1

How a Lightning merchant exposes itself to any agent, in four pieces. The merchant's wallet mints every
invoice; the preimage is the receipt; nobody in the middle holds money. This is the Lightning counterpart
to card-based agent-commerce protocols, and it is deliberately small.

## 1. Manifest — `https://<host>/.well-known/anvard.json`

```json
{
  "anvard": "0.1",
  "merchant": { "slug": "cardboard-castle", "name": "Cardboard Castle", "website": "https://cardboard-castle.example", "country": "US", "description": "Singles and sealed." },
  "endpoints": {
    "products": "https://cardboard-castle.example/anvard/products",
    "checkout": "https://cardboard-castle.example/anvard/checkout",
    "order": "https://cardboard-castle.example/anvard/orders/{id}"
  },
  "signingPubkey": "<hex nostr pubkey, optional in v0>"
}
```

`slug` is `[a-z0-9][a-z0-9-]{1,62}`. Endpoints may be relative to the host; they must be https.

## 2. Product feed — `GET endpoints.products`

```json
{ "anvard": "0.1", "merchant": "cardboard-castle", "updatedAt": "2026-10-21T12:00:00Z",
  "products": [
    { "id": "charizard-base-4-102-lp", "title": "Charizard (Base Set) 4/102", "category": "tcg",
      "priceCents": 42000, "kind": "physical", "inStock": true, "imageUrl": "https://…",
      "tcg": { "game": "pokemon", "set": "Base Set", "number": "4/102", "condition": "LP", "grade": null,
               "provenanceUrl": "https://tcg-provenance.vercel.app/r/abc123" } } ] }
```

Exactly one of `priceCents` (integer USD cents) or `priceSats` (integer sats). `category` is one of
`tcg, books, apparel, gift-cards, home, kids, sports, food, art, electronics, other`. `kind` is `digital`
or `physical`. Up to 5,000 products per feed. Bad rows are skipped, never fatal. `tcg` is optional and
carries `game, set, number, condition, grade, finish, language, provenanceUrl` (https).

## 3. Checkout — `POST endpoints.checkout`

```json
{ "anvard": "0.1", "items": [{ "productId": "charizard-base-4-102-lp", "qty": 1 }],
  "shipping": { "name": "…", "address": "…", "city": "…", "region": "CO", "postal": "80202", "country": "US" },
  "contact": "buyer@example.com", "buyerRef": "opaque" }
```

Response `201`:

```json
{ "anvard": "0.1", "orderId": "cc-77", "bolt11": "lnbc…", "paymentHash": "<64 hex>",
  "amountSats": 505000, "totalCents": 42000, "expiresAt": "2026-10-21T12:10:00Z", "fulfilment": "shipped" }
```

The BOLT11 is minted by the merchant's own wallet for the whole order. Shipping is sent to the merchant
over HTTPS and is theirs to keep; the directory never stores it in the clear. `fulfilment: "instant"` means
digital goods delivered via `redemption` once paid; `"shipped"` means the order is complete at `paid` and
the merchant fulfils later.

## 4. Order status — `GET endpoints.order` with `{id}`

```json
{ "anvard": "0.1", "orderId": "cc-77", "state": "paid", "paymentHash": "<64 hex>",
  "paidAt": "…", "fulfilledAt": null, "redemption": null, "note": "USPS 9400…" }
```

`state` is `unpaid | paid | fulfilled | cancelled`. The merchant observes settlement on its own wallet. A
payer can always prove payment with the preimage (`sha256(preimage) == paymentHash`).

## Directory

A host may also serve `/.well-known/anvard.json` as a **directory**: `{ "anvard": "0.1", "directory": [ { "slug", "name", "manifest", "products" } ] }`.
Anvard serves one for every verified merchant it lists, including shops hosted elsewhere.

## Implementing it

- **You run a shop and want in:** serve the manifest and feed (a static file is fine), and a checkout
  that returns your wallet's invoice. Then connect the host from your Anvard dashboard; the catalogue syncs
  every 30 minutes.
- **BTCPay Server:** a plugin that serves these four from your BTCPay products and invoices is the planned
  route (OQ-21); until then a small sidecar does the same.
- **Shopify / TCGplayer / BinderPOS:** import your products from the dashboard (CSV or the public
  products.json). Orders then checkout through Anvard with the invoice minted on your wallet.
- **Reference implementation:** Anvard's own merchants are served at `/api/commerce/<slug>/manifest`,
  `/products`, `/checkout` and `/api/commerce/orders/{id}`.
