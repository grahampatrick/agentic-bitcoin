/**
 * Signal via signal-cli's HTTP JSON-RPC daemon (signal-cli-jsonrpc(5), verified 2026-10-08):
 *
 *   signal-cli -a +1… daemon --http localhost:8080 --no-receive-stdout
 *   POST /api/v1/rpc     {"jsonrpc":"2.0","id":…,"method":"send","params":{"recipient":["+1…"],"message":"…"}}
 *   GET  /api/v1/events  SSE; each `data:` line is a JSON-RPC notification:
 *                        {"jsonrpc":"2.0","method":"receive","params":{"envelope":{sourceNumber,sourceName,dataMessage:{message,timestamp},…}}}
 *   GET  /api/v1/check   health
 *
 * Single-account mode (`-a`) needs no `account` param; multi-account mode requires it. Signal has
 * no buttons: a confirmation is a plain "yes"/"no" reply, bound by the dispatcher to the user's
 * latest pending action hash.
 */
import type { ChatSurface, InboundMessage, OutboundMessage } from "./surface"

export interface SignalOptions {
  /** e.g. http://localhost:8080 */
  daemonUrl: string
  /** The bot's own number, E.164. Sent as `account` only when `multiAccount` is true. */
  account: string
  multiAccount?: boolean
  fetchImpl?: typeof fetch
  /** Reconnect delay after the event stream drops. */
  reconnectMs?: number
  /**
   * Linked-device test mode: when the daemon is a LINKED device on the operator's own account,
   * "Note to Self" on the phone arrives as a sync message. Treat those as inbound from the own
   * number and reply into Note to Self. Off by default (a real deployment has its own number).
   */
  noteToSelf?: boolean
}

export class SignalSurface implements ChatSurface {
  readonly kind = "signal"
  private abort: AbortController | null = null
  private readonly fetchImpl: typeof fetch
  private rpcId = 0
  /** Texts we sent recently; our own notes come back as sync messages and must not loop. */
  private readonly recentlySent: string[] = []
  constructor(private readonly opts: SignalOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch
  }

  /** True when the daemon answers its health endpoint. */
  async check(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.opts.daemonUrl}/api/v1/check`, {
        signal: AbortSignal.timeout(3000),
      })
      return res.ok
    } catch {
      return false
    }
  }

  async start(onMessage: (m: InboundMessage) => Promise<void>) {
    this.abort = new AbortController()
    const loop = async () => {
      while (this.abort && !this.abort.signal.aborted) {
        try {
          const res = await this.fetchImpl(`${this.opts.daemonUrl}/api/v1/events`, {
            signal: this.abort.signal,
            headers: { accept: "text/event-stream" },
          })
          if (!res.ok || !res.body) throw new Error(`events: HTTP ${res.status}`)
          for await (const ev of parseSse(res.body)) {
            const inbound = inboundOf(ev, this.opts.account, this.opts.noteToSelf ?? false)
            if (!inbound) continue
            if (
              inbound.userId === `signal:${this.opts.account}` &&
              this.recentlySent.includes(inbound.text)
            )
              continue
            await onMessage(inbound)
          }
        } catch (err) {
          if (this.abort?.signal.aborted) return
          console.error("[signal] stream error, reconnecting:", (err as Error).message)
          await new Promise((r) => setTimeout(r, this.opts.reconnectMs ?? 2000))
        }
      }
    }
    void loop()
  }

  async send(userId: string, m: OutboundMessage) {
    const recipient = userId.replace(/^signal:/, "")
    const toSelf = recipient === this.opts.account
    const params: Record<string, unknown> = toSelf
      ? { noteToSelf: true, message: m.text }
      : { recipient: [recipient], message: m.text }
    if (this.opts.multiAccount) params.account = this.opts.account
    if (toSelf) {
      this.recentlySent.push(m.text)
      if (this.recentlySent.length > 50) this.recentlySent.shift()
    }
    const res = await this.fetchImpl(`${this.opts.daemonUrl}/api/v1/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++this.rpcId, method: "send", params }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`signal send failed: HTTP ${res.status}`)
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    if (body.error) throw new Error(`signal send failed: ${body.error.message ?? "rpc error"}`)
  }

  async stop() {
    this.abort?.abort()
    this.abort = null
  }
}

type Envelope = {
  source?: string
  sourceNumber?: string
  sourceName?: string
  dataMessage?: { message?: string | null; timestamp?: number }
  syncMessage?: {
    sentMessage?: {
      destination?: string | null
      destinationNumber?: string | null
      message?: string | null
      timestamp?: number
    }
  }
  receiptMessage?: unknown
  typingMessage?: unknown
}
type SignalEvent = {
  method?: string
  params?: { envelope?: Envelope; result?: unknown }
  envelope?: Envelope
}

/**
 * A `receive` notification with a text data message → InboundMessage. Everything else → null.
 * In noteToSelf mode, a sync `sentMessage` from the own number to itself (Note to Self) counts too.
 */
export function inboundOf(
  ev: SignalEvent,
  ownAccount: string,
  noteToSelf = false,
): InboundMessage | null {
  const env = ev.params?.envelope ?? ev.envelope
  if (!env) return null
  const from = env.sourceNumber ?? env.source
  const text = env.dataMessage?.message
  if (from && typeof text === "string" && text.trim()) {
    if (from === ownAccount) return null // our own copies
    return {
      userId: `signal:${from}`,
      text,
      messageId: env.dataMessage?.timestamp ? String(env.dataMessage.timestamp) : undefined,
    }
  }
  const sent = env.syncMessage?.sentMessage
  if (
    noteToSelf &&
    from === ownAccount &&
    sent &&
    typeof sent.message === "string" &&
    sent.message.trim()
  ) {
    const dest = sent.destinationNumber ?? sent.destination ?? null
    if (dest === null || dest === ownAccount) {
      return {
        userId: `signal:${ownAccount}`,
        text: sent.message,
        messageId: sent.timestamp ? String(sent.timestamp) : undefined,
      }
    }
  }
  return null
}

/** Minimal SSE parser: yields the JSON of each `data:` line (keepalives and non-JSON are skipped). */
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
      const data = chunk
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("\n")
      if (data) {
        try {
          yield JSON.parse(data) as SignalEvent
        } catch {
          /* keepalive or partial */
        }
      }
      idx = buf.indexOf("\n\n")
    }
  }
}
