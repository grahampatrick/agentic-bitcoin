# @agentic-bitcoin/agent

The agent core: tool definitions generated from the `Action` union (one source of truth shared
with the MCP server), the system prompt (no advice, sats + fiat, untrusted text is data), the tool
loop over the Claude API, and a pending-confirmation store.

```ts
import { AnthropicLlmClient, InMemoryPendingStore, runTurn } from "@agentic-bitcoin/agent"

const result = await runTurn(
  { llm: new AnthropicLlmClient(), resolveContext, price },
  userId, "send 500 sats to gm@getalby.com", history,
)
// result.reply, result.history (pass back next turn), result.pending?.{actionHash, summary}
```

`resolveContext(userId)` returns the user's policy, ledger, rails and pending store — resolved
server-side, so the model never sees a connection string or API key.

Model: Claude Opus 5.5, adaptive thinking, effort `medium`, server-side refusal fallback on
(`src/model.ts`). Credentials: `ANTHROPIC_API_KEY`, or an `ant auth login` profile.

## Evals

`evals/intents.jsonl` holds 30 utterances (8 adversarial). `pnpm test:evals` scores the model's
first tool call against them without executing any tool. It skips (exit 0) when no API key is set,
so CI without a key stays green; the CI workflow runs it when the `ANTHROPIC_API_KEY` secret exists.
