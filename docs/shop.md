# The store

`/shop` is an aggregator: products listed by Lightning merchants, paid with one invoice per merchant
that the merchant's own wallet creates. Agentic Bitcoin never holds the money and is never the
merchant of record (ADR-0016).

## Buying

- **On the web:** browse, add to cart, checkout per merchant. Physical goods ask for a shipping
  address, which is sealed for that merchant only. You get a Lightning invoice (QR, `lightning:` link).
  If the merchant's wallet is connected to us, the order page notices the payment by itself; otherwise
  paste the payment preimage your wallet shows and we verify it against the invoice hash.
- **By text:** "find me a study bible" returns results with prices and store links; `buy <id> for $X`
  buys it after you confirm, and for physical goods you add `ship to name, street, city, region,
  postal, country`. The address is sealed before the purchase is recorded. `/orders` lists yours.
- **From Signal into the store:** `/shop` sends you the link; every product page shows the exact text
  to send back.

## Selling

1. Onboard at `/receive` as a **merchant** with a Lightning address you already have or a receive-only
   wallet connection. You get a dashboard link (shown once).
2. The operator verifies you (`/verify <slug>` in the bot). Until then you are not listed and cannot sell.
3. On your dashboard: add products (title, price in dollars, optional deal price, category, digital or
   physical, image link), mark stock, and watch orders. Paid orders show the buyer's shipping details
   (decrypted for you alone) and a "mark fulfilled" button with a note (tracking number, or the download
   link for digital goods, which the buyer sees on their order page).
4. Refunds: Lightning has none; pay the buyer back to their Lightning address and mark the order.

## Operator

- Seed a catalogue with `SHOP_FILE` (see `apps/bot/shop.example.json`); merchants must exist as recipients
  (`RECIPIENTS_FILE`, kind `merchant`, verified).
- Supabase: migration `0007_shop.sql`. Without a database the web shows a clearly labelled demo catalogue.
- Bitrefill stays available for gift cards and top-ups when a user has set `/key bitrefill`.
