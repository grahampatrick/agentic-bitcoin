# Virtual Lightning cards

A card is a monthly budget on your own wallet for one kind of spend. Nothing is deposited on it.

**Create one in chat:** "create a virtual card for steam with a 50,000 sat monthly limit". The
assistant shows the summary; reply yes. You get a card page link (`/card/<id>?t=…`) — the token is
shown once, so keep the link.

**What a card pays** (its scope), any of: `product:steam` (gift cards or products whose name contains
the text), `merchant:bitrefill`, `shop:<store slug>`, `bob@coffee.example` or `*@coffee.example`,
`api.example.com` (paid APIs), `rail:goods`, `kind:pay_address`, `*`.

**Limits:** monthly cap (resets on a day of the month, UTC), optional max per payment, optional
"ask me above" threshold. Your own daily and per-action caps still apply first; a card never raises
anything.

**Manage:** "my cards" · "pause my steam card" (instant) · "resume my steam card" / "raise my steam
card to 80,000 sats" (you confirm) · `/cards`, `/cards pause <id>` · the card page's Pause button.

**When a payment is denied by a card** the assistant names the card and what is left on it.

Self-hosting: migration `0012_cards.sql`; the bot uses the file store without a database.
