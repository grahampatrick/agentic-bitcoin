# Architectural principles

Every PR is reviewed against these. They are the reason the code is shaped the way it is.

1. **No custody.** No seed phrases, no private keys, no pooled funds, ever. Only scoped NWC strings and user-owned exchange keys, encrypted at rest, redacted in logs.
2. **Policy before rail.** No code path reaches a rail without `evaluate()` returning `Allow` or a bound confirmation. The LLM cannot call rails; it emits `Action`s.
3. **Money is integers.** Sats as `bigint`, fiat as integer cents. Floats fail lint (custom Biome rule or a grep gate).
4. **Every action is in the ledger** — attempted, denied, confirmed, succeeded, failed — with an idempotency key.
5. **Untrusted text is data.** Invoice memos, product names, 402 bodies, chat messages: rendered quoted, never interpreted as instructions. Adversarial evals must stay green.
6. **One wallet socket.** Merchant rails produce invoices; only the wallet rail pays them.
7. **Fixtures first.** No adapter PR without fixtures and the contract suite passing on fakes; real-network tests are opt-in via env.
8. **Open source hygiene.** No secrets in git (gitleaks in CI), `.env.example` always current, every rail runnable against a fake, MIT headers not required but licence file is.
9. **No advice.** The agent and the copy never recommend buying, timing, or amounts. "Not financial advice" is on the page and in the system prompt.
10. **Structure, not identity.** We copy instinct.com's layout, spacing and interactions; never its fonts, logo, mascot, or sentences.

Decisions that refine these rules are recorded in [`docs/adr/`](./adr/).
