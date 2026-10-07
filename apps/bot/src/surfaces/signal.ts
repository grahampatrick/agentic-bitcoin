/**
 * Signal via signal-cli's JSON-RPC daemon (`signal-cli -a +1... daemon --http localhost:8080`).
 * Signal has no buttons: a confirmation is a plain "yes" / "no" reply, bound by the dispatcher to
 * the user's latest pending action hash. Receives through the daemon's SSE event stream.
 */
import type { ChatSurface, InboundMessage, OutboundMessage } from "./surface"

export interface SignalOptions {
  /** e.g. http://localhost:8080 */
  daemonUrl: string
  /** The bot's own number, E.164. */
  account: string
  fetchImpl?: typeof fetch
}

export class SignalSurface implements ChatSurface {
  readonly kind = "signal"
  private abort: AbortController | null = null
  private readonly fetchImpl: typeof fetch
  constructor(private readonly opts: SignalOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch
  }

  async start(onMessage: (m: InboundMessage) => Promise<void>) {
    this.abort = new AbortController()
    const loop = async () => {
      while (this.abort && !this.abort.signal.aborted) {
        try {
          const res = await this.fetchImpl(
            `${this.opts.daemonUrl}/api/v1/events?account=${encodeURIComponent(this.opts.account)}`,
            {
              signal: this.abort.signal,
              headers: { accept: "text/event-stream" },
            },
          )
          if (!res.body) throw new Error("no body")
          for await (const ev of parseSse(res.body)) {
            const env = ev.envelope
            const dm = env?.dataMessage
            if (!env?.sourceNumber || !dm?.message) continue
            await onMessage({ userId: `signal:${env.sourceNumber}`, text: dm.message })
          }
        } catch (err) {
          if (this.abort?.signal.aborted) return
          console.error("[signal] stream error, reconnecting:", (err as Error).message)
          await new Promise((r) => setTimeout(r, 2000))
        }
      }
    }
    void loop()
  }

  async send(userId: string, m: OutboundMessage) {
    const recipient = userId.replace(/^signal:/, "")
    const res = await this.fetchImpl(`${this.opts.daemonUrl}/api/v1/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "send",
        params: { account: this.opts.account, recipient: [recipient], message: m.text },
      }),
    })
    if (!res.ok) throw new Error(`signal send failed: HTTP ${res.status}`)
  }

  async stop() {
    this.abort?.abort()
    this.abort = null
  }
}

type SignalEvent = { envelope?: { sourceNumber?: string; dataMessage?: { message?: string } } }

/** Minimal SSE parser: yields the JSON of each `data:` line. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SignalEvent> {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ""
  while (true) {
    const { value, done } = await reader.read()
    if (done) return
    buf += dec.decode(value, { stream: true })
    let idx = buf.indexOf("\n\n")
    while (idx !== -1) {
      const chunk = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data:")) {
          try {
            yield JSON.parse(line.slice(5).trim()) as SignalEvent
          } catch {
            /* ignore non-JSON keepalives */
          }
        }
      }
      idx = buf.indexOf("\n\n")
    }
  }
}
