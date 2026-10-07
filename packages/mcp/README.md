# @agentic-bitcoin/mcp

MCP server exposing the Agentic Bitcoin tools to any MCP host. Same definitions as the agent.

```bash
# stdio (Claude Code / Claude Desktop config: command = "pnpm", args = ["--filter","@agentic-bitcoin/mcp","start"])
NWC_URL=… pnpm --filter @agentic-bitcoin/mcp start
# Streamable HTTP on http://localhost:3901/mcp
NWC_URL=… pnpm --filter @agentic-bitcoin/mcp start -- --http 3901
# Inspect
npx @modelcontextprotocol/inspector pnpm --filter @agentic-bitcoin/mcp start
```

Without `NWC_URL` the FAKE wallet is used (no real sats). `POLICY_JSON` overrides `DEFAULT_POLICY`
(bigints as `"123n"` strings). Confirmation protocol: a spend over the threshold returns
`awaiting_confirmation` with a `summary` and `action_hash`; show the summary to the human and call
`confirm_action` with that hash only on an explicit yes.
