/**
 * The LLM boundary. The agent loop depends on this interface; the Anthropic implementation is
 * the only place the SDK is touched, so tests inject a scripted fake.
 */
import Anthropic from "@anthropic-ai/sdk"
import { EFFORT, FALLBACKS_ENABLED, MAX_TOKENS, MODEL } from "./model"

export type LlmMessage = Anthropic.Beta.BetaMessageParam
export type LlmTool = Anthropic.Beta.BetaTool
export type LlmContentBlock = Anthropic.Beta.BetaContentBlock

export interface LlmResponse {
  content: LlmContentBlock[]
  stop_reason: string | null
}

export interface LlmClient {
  complete(req: { system: string; messages: LlmMessage[]; tools: LlmTool[] }): Promise<LlmResponse>
}

export class AnthropicLlmClient implements LlmClient {
  private readonly client: Anthropic
  constructor(client?: Anthropic) {
    // Zero-arg: resolves ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / an `ant auth login` profile.
    this.client = client ?? new Anthropic()
  }

  async complete(req: {
    system: string
    messages: LlmMessage[]
    tools: LlmTool[]
  }): Promise<LlmResponse> {
    const res = await this.client.beta.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Stable prefix first (system, tools) so the cache holds across turns; per-turn text follows.
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      tools: req.tools,
      messages: req.messages,
      output_config: { effort: EFFORT },
      ...(FALLBACKS_ENABLED
        ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }
        : {}),
    })
    return { content: res.content, stop_reason: res.stop_reason }
  }
}
