/**
 * One chat surface interface; Telegram and Signal are adapters. The dispatcher never knows which.
 */
export interface InboundMessage {
  userId: string
  text: string
  /** A button press or a reply that is a confirmation decision, when the surface can tell. */
  decision?: { actionHash: string; approve: boolean }
}

export interface OutboundMessage {
  text: string
  /** Surfaces with buttons render these; Signal ignores them and the text already says "reply yes/no". */
  confirm?: { actionHash: string }
}

export interface ChatSurface {
  readonly kind: string
  start(onMessage: (m: InboundMessage) => Promise<void>): Promise<void>
  send(userId: string, m: OutboundMessage): Promise<void>
  stop(): Promise<void>
}

/** In-memory surface for tests and the CLI demo. */
export class FakeSurface implements ChatSurface {
  readonly kind = "fake"
  readonly sent: { userId: string; m: OutboundMessage }[] = []
  private handler: ((m: InboundMessage) => Promise<void>) | null = null
  async start(onMessage: (m: InboundMessage) => Promise<void>) {
    this.handler = onMessage
  }
  async send(userId: string, m: OutboundMessage) {
    this.sent.push({ userId, m })
  }
  async stop() {
    this.handler = null
  }
  async receive(m: InboundMessage) {
    if (!this.handler) throw new Error("not started")
    await this.handler(m)
  }
}
