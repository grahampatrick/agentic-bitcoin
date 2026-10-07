# ADR-0003: Newsreader (serif) + Inter (sans), self-hosted via next/font

**Date:** 2026-10-07 · **Status:** accepted · resolves plan.md OQ-1

## Context
The reference uses a warm, slightly condensed serif at 24px with a semibold for the headline. We
need an OFL face with a real 600 weight at text sizes, and a neutral sans for the 13px legal row.

## Decision
Compared Newsreader, Source Serif 4, Instrument Serif and Fraunces at 24px/130% with the actual
headline. Newsreader has the closest texture and colour at this size, ships an optical-size axis
(so 24px gets the text cut, not the display cut) and a true 600. Instrument Serif has no bold;
Source Serif reads cooler and wider; Fraunces is too mannered.

Inter for the sans: unremarkable on purpose, with tabular numerals for the price line.

Both load through `next/font/google`, which downloads at build time and self-hosts the subset, so the
page makes no runtime request to Google.

## Consequences
- next/font sets `--font-newsreader` / `--font-inter` on `<html>`; the brand tokens `--font-serif` /
  `--font-sans` reference them with fallbacks. The two layers must keep different names: a token
  that references a variable of its own name on `:root` is a cycle and the browser drops it.
- Changing a face is a two-line edit in `app/layout.tsx` plus this ADR.
