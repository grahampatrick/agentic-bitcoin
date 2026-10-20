# Wallet deep links (OQ-19)

Every Lightning wallet registers the `lightning:` URI, so "Open in your wallet" works everywhere and
is the only link we call verified. The per-wallet buttons use the schemes each app documents or is
widely reported to open. A row flips to **verified** only after a real-phone test.

| Wallet | Link we use | iOS | Android | Verified by |
|---|---|---|---|---|
| any | `lightning:<BOLT11>` | yes | yes | spec |
| Strike | `lightning:` | ? | ? | — |
| Cash App | `lightning:` | ? | ? | — (OQ-20: does Cash App open third-party `lightning:` links at all?) |
| Zeus | `zeusln:lightning:<BOLT11>` | ? | ? | — |
| Phoenix | `phoenix:lightning:<BOLT11>` | ? | ? | — |
| Wallet of Satoshi | `walletofsatoshi:lightning:<BOLT11>` | ? | ? | — |
| Blixt | `blixtwallet:lightning:<BOLT11>` | ? | ? | — |
| Breez | `breez:lightning:<BOLT11>` | ? | ? | — |
| Muun | `muun:<BOLT11>` | ? | ? | — |
| Alby (extension) | WebLN `sendPayment` | desktop | desktop | — |

Browser wallets that expose WebLN pay in-page and return the **preimage**, which the page posts to
`/api/.../paid`; that is proof of payment without the merchant's wallet being connected.

To verify a row: open a product page on the phone with the wallet installed, tap the wallet's button,
confirm the app opens with the invoice loaded, pay, and confirm the page flips to paid. Record the OS
version and app version here.
