# ADR-0026 — The Anvard mark: an ornate A and a castle, drawn by us

**Date:** 2026-10-28 · **Status:** accepted (castle only for now; the A is drawn but not shown) · replaces the logo bullet of ADR-0002

## Context

The product is now Anvard (ADR-0019 names it; anvard.ai). Anvard is a castle on a hill, so the
brief for the mark was: an ornate capital letter in the manner of a fantasy film title, red with a
gold edge, and a line-drawn castle on a hill in place of the stick figure. The references shown to
us were a studio's trademarked title letter and a published book illustration. Both are protected
expression, like Instinct's logo was in ADR-0002.

## Decision

1. **Two original drawings, nothing traced.** `AnvardMark` is our own capital A: a thin left stroke,
   a heavy right stroke, flared pointed feet, a horned apex, and a slanted crossbar with a nick cut
   into its underside. `Castle` is our own composition: a round tower, a keep with a tall inner
   tower, a square tower with a corner turret, a gate, on a hatched hill. Neither is a copy of the
   references; they share a manner (red and gold bevel; pen-and-ink castle), which is not protectable.
2. **The bevel is a filter, not geometry.** The gold bands, the pale inline and the shadow are an SVG
   filter over a single red fill, so the legs and the crossbar read as one cast letter with no seams,
   and the letter can be re-shaped by editing two paths.
3. **The castle stays in the doodle hand.** `currentColor`, 1.4 stroke, round caps, like the task
   reaction icons, so it sits in the header without a second visual language.
4. **The header is a lockup.** The A beside the castle, sized by height (`--layout-logo-height`)
   rather than the old width token, because the castle is landscape.
5. **The A is also the favicon** (`app/icon.svg`), without the inline and shadow, which disappear at
   16 px anyway.

## Consequences

- ADR-0002's "the logo" bullet now points here.
- The site's words still say Agentic Bitcoin; the rename of copy, domain and metadata is a separate
  change on the launch checklist, not part of the mark.
- The filter uses `feMorphology`, which every current browser supports; without filters the letter
  degrades to a plain red A, still legible.
- 2026-10-28, later the same day: GM asked for the castle alone in the header and no A for now. `AnvardMark`
  stays in `Logo.tsx`, unrendered, and the favicon is removed until the A comes back.
