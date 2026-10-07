// Smoke test for the built binary: `pnpm build && pnpm smoke`. Spawns dist/cli.js over stdio with the fake wallet.
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
const transport = new StdioClientTransport({ command: "node", args: [process.argv[2]], env: { ...process.env, PRICE_URL: "http://127.0.0.1:9/none" }, stderr: "pipe" })
const client = new Client({ name: "smoke", version: "0" })
await client.connect(transport)
const { tools } = await client.listTools()
console.log("tools:", tools.map((t) => t.name).join(", "))
const r = await client.callTool({ name: "get_balance", arguments: {} })
console.log("get_balance:", r.content[0].text)
await client.close()
