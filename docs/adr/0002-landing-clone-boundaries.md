# ADR-0002: What we copy from instinct.com, and what we do not

**Date:** 2026-10-07 · **Status:** accepted

## Context
The brief is "copy the exact simple landing page and style" of instinct.com. Layout, spacing and
interaction patterns are not protectable expression; fonts, logos and sentences are.

## Decision
We copy, from measurement (see plan.md "Reference"):
- Structure: logo-only header, one 41rem column, three beats + CTA, legal footer, `space-between`.
- Metrics: 24px / 130% / −0.01em intro type, 13px legal, spacing scale, 20vh intro bottom margin.
- Colours: the sand / onyx / ivory palette values.
- Interactions: hair-line task underline, hover reaction bubble with the spring curve, thick CTA
  underline, staggered reveal, reduced-motion fallback.

We do **not** copy:
- Fonts. Aime and Melange are commercial. We use Newsreader + Inter (OFL), see ADR-0003.
- The logo. Ours is a different hand-drawn figure holding a coin (`components/Logo.tsx`).
- Copy. Every sentence is ours or a verbatim, attributed whitepaper phrase.
- Their images, scripts, or any asset file.

## Consequences
- A reviewer can diff `home.css` against the measured values in plan.md.
- `copy.test.ts` guards that the whitepaper quotes stay verbatim and that no advice creeps in.
