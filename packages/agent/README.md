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

## Views and settings (ADR-0029)

Two tools serve what slash commands used to: `show` (read a view) and `change_setting` (propose one
change). Both need a `desk` on the `UserContext`; without one they answer "not configured".

```ts
const ctx: UserContext = { ...rest, desk: { show, check, change } }  // see core `Desk`
```

- A change that narrows applies at once; one that widens returns `awaiting_confirmation`.
- `confirm_action` refuses a parked `change_setting`: only the surface's own yes path
  (`confirmPending` with the user as `confirmedBy`) applies it.
- A view's `direct` text (a bearer link, a CSV) comes back as `deliveries`, never in the history.
- After a setting applies mid-turn, the loop re-resolves the context so later calls run under it.

## Evals

`evals/intents.jsonl` holds 97 utterances (22 adversarial), including every view and setting a
person can ask for and four attempts to make the model move or approve a limit. `pnpm test:evals` scores the model's
first tool call against them without executing any tool. It skips (exit 0) when no API key is set,
so CI without a key stays green; the CI workflow runs it when the `ANTHROPIC_API_KEY` secret exists.
