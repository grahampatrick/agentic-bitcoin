# ADR-0007: The agent is an MCP server first, a chatbot second

**Date:** 2026-10-07 · **Status:** accepted · Implemented in `packages/agent/src/tools.ts`, `packages/mcp`

## Decision
- Tool definitions are generated once, from the `Action` union, in `packages/agent/src/tools.ts`.
  The Claude agent loop and the MCP server both consume that list; adding a rail means adding one
  entry there and the tool appears in both.
- `@agentic-bitcoin/mcp` exposes the tools over stdio and Streamable HTTP using the low-level
  MCP `Server` with JSON Schema directly (no second schema language).
- `confirm_action` exists as a tool so a host agent (Claude Code, Claude Desktop, another agent)
  can complete the same confirmation protocol: it receives `awaiting_confirmation` with a summary
  and an `action_hash`, shows the summary to its human, and calls `confirm_action` only on an
  explicit yes. The hash is bound to the exact action in the core executor, so a host that
  "confirms" something else gets `no_pending_action`.
- Tool inputs are plain JSON with integer sats/cents; the conversion to bigint Actions and the
  idempotency key happen server-side in `toolToAction`. MCP clients give no schema guarantees, so
  every input is validated before conversion.
- The model for our own chat agent is Claude Opus 5.5 with adaptive thinking and `medium` effort
  (OQ-5), with the server-side refusal fallback enabled; see `packages/agent/src/model.ts`.

## Why
Distribution: every MCP-capable agent becomes a user of the rails without us building a UI for it.
Safety: one tool list means one audit surface, and the policy engine sits under both callers.

## Consequences
- The MCP server runs with one configured user context (env) today; multi-user auth is M7.
- Secrets never cross the MCP boundary: tools execute with server-held credentials.
