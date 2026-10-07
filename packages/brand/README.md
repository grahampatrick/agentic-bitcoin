# @agentic-bitcoin/brand

Design tokens, generated into CSS custom properties.

```ts
import { tokens } from "@agentic-bitcoin/brand"
tokens.color.sand400 // "#e1d5cd"
```

```css
/* after `pnpm --filter @agentic-bitcoin/brand build` */
@import "@agentic-bitcoin/brand/tokens.css";
.cta { text-decoration-color: var(--color-sand-400); }
```

`pnpm test` in this package fails if `tokens.css` is stale (CI drift guard). Never hand-edit it.
Values come from measuring instinct.com; see `plan.md` and ADR-0002 for what we do and don't copy.
