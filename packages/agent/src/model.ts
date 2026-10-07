/**
 * Model choice (plan OQ-5, resolved 2026-10-07 after reading the claude-api reference):
 * Claude Opus 5.5 — the current default Opus. Thinking is always on (adaptive); depth is
 * controlled by effort, whose default on this model is `medium`, so it is set explicitly.
 * Chat replies are short by design, hence the modest max_tokens.
 */
export const MODEL = "claude-opus-5-5"
export const EFFORT: "low" | "medium" | "high" = "medium"
export const MAX_TOKENS = 4096
/** Server-side refusal fallback ("default" routes by refusal category). Set false to disable. */
export const FALLBACKS_ENABLED = true
