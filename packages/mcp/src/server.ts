/**
 * The MCP server (ADR-0007): the same tool definitions as the agent, exposed to any MCP host
 * (Claude Code, Claude Desktop, other agents). Every call goes through core `execute` with the
 * configured policy; `confirm_action` releases a parked action — the host agent shows the summary
 * to its human and calls confirm_action only on an explicit yes.
 */
import { TOOLS, type UserContext, handleToolCall } from "@agentic-bitcoin/agent"
import type { PriceSnapshot } from "@agentic-bitcoin/core"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"

export interface McpDeps {
  resolveContext(): Promise<UserContext>
  price(): Promise<PriceSnapshot | undefined>
  now?: () => Date
}

export function createServer(deps: McpDeps): Server {
  const server = new Server(
    { name: "agentic-bitcoin", version: "0.0.0" },
    { capabilities: { tools: {} } },
  )
  const now = deps.now ?? (() => new Date())
  let seq = 0

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.input_schema,
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const ctx = await deps.resolveContext()
    const price = await deps.price()
    const callId = `${ctx.userId}:mcp:${now().getTime().toString(36)}:${(++seq).toString(36)}`
    const out = await handleToolCall(ctx, req.params.name, req.params.arguments ?? {}, {
      callId,
      price,
      now,
    })
    return { content: [{ type: "text", text: out.content }], isError: out.isError }
  })

  return server
}
