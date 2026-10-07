# Contributing

Thanks for looking. This project moves money for people, so the bar is "boring and verifiable".

## Before you open a PR

1. Read `plan.md` — especially **Architectural Non-Negotiables**. Every PR is reviewed against them.
2. Run the gates locally: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
3. If you made a non-obvious decision, add `docs/adr/NNNN-short-title.md` in the same PR.
4. Fixtures go in the shared fixtures package (from M1), never duplicated per package.
5. New rail adapters ship with fakes and must pass the contract suite before any real-network test.

## Rules that will fail review

- Floats anywhere near money. Sats are integers, fiat is integer cents.
- Secrets, connection strings, or API keys in code, fixtures, tests, or docs.
- Any code path that reaches a rail without the policy engine.
- Copy that recommends buying, timing, or amounts.
- Logging a wallet connection string, invoice preimage, gift-card code, or exchange key.

## Reporting a security issue

See `SECURITY.md`. Please do not open a public issue for anything wallet-related.
