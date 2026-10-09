/**
 * The adapter against a fake signal-cli daemon that speaks the documented HTTP/SSE format:
 * JSON-RPC `receive` notifications on /api/v1/events, `send` on /api/v1/rpc, /api/v1/check.
 */
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { SignalSurface, inboundOf, parseSse } from "./signal"
import type { InboundMessage } from "./surface"

const sent: unknown[] = []
let pushEvent: ((obj: unknown) => void) | null = null
const server = createServer((req, res) => {
  if (req.url === "/api/v1/check") {
    res.writeHead(200, { "content-type": "application/json" })
    return res.end('{"ok":true}')
  }
  if (req.url === "/api/v1/rpc" && req.method === "POST") {
    let body = ""
    req.on("data", (c) => {
      body += c
    })
    req.on("end", () => {
      const rpc = JSON.parse(body)
      sent.push(rpc)
      res.writeHead(200, { "content-type": "application/json" })
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: rpc.id,
          result: {
            timestamp: Date.now(),
            results: [
              {
                recipientAddress: { number: rpc.params.recipient?.[0] ?? "self" },
                type: "SUCCESS",
              },
            ],
          },
        }),
      )
    })
    return
  }
  if (req.url === "/api/v1/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
    res.write(": keepalive\n\n")
    pushEvent = (obj) => res.write(`data:${JSON.stringify(obj)}\n\n`)
    req.on("close", () => {
      pushEvent = null
    })
    return
  }
  res.writeHead(404)
  res.end()
})
let url = ""
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

describe("SignalSurface against a fake daemon", () => {
  it("checks health, receives documented `receive` notifications, ignores receipts/typing/own echoes, and sends", async () => {
    const got: InboundMessage[] = []
    const s = new SignalSurface({ daemonUrl: url, account: "+15550001111" })
    expect(await s.check()).toBe(true)
    await s.start(async (m) => {
      got.push(m)
    })
    for (let i = 0; i < 50 && !pushEvent; i++) await new Promise((r) => setTimeout(r, 20))
    expect(pushEvent).not.toBeNull()
    const push = pushEvent as (o: unknown) => void
    push({
      jsonrpc: "2.0",
      method: "receive",
      params: {
        envelope: {
          source: "+15552223333",
          sourceNumber: "+15552223333",
          sourceName: "Alice",
          timestamp: 1,
          dataMessage: { timestamp: 1700000000123, message: "pay 500 sats to gm@getalby.com" },
        },
      },
    })
    push({
      jsonrpc: "2.0",
      method: "receive",
      params: {
        envelope: { sourceNumber: "+15552223333", receiptMessage: { when: 1, isDelivery: true } },
      },
    })
    push({
      jsonrpc: "2.0",
      method: "receive",
      params: { envelope: { sourceNumber: "+15552223333", typingMessage: { action: "STARTED" } } },
    })
    push({
      jsonrpc: "2.0",
      method: "receive",
      params: {
        envelope: { sourceNumber: "+15550001111", dataMessage: { message: "my own sync copy" } },
      },
    })
    for (let i = 0; i < 50 && got.length < 1; i++) await new Promise((r) => setTimeout(r, 20))
    expect(got).toEqual([
      {
        userId: "signal:+15552223333",
        text: "pay 500 sats to gm@getalby.com",
        messageId: "1700000000123",
      },
    ])
    await s.send("signal:+15552223333", { text: "Paid." })
    expect(sent[0]).toMatchObject({
      jsonrpc: "2.0",
      method: "send",
      params: { recipient: ["+15552223333"], message: "Paid." },
    })
    expect((sent[0] as { params: Record<string, unknown> }).params.account).toBeUndefined()
    await s.stop()
  })
  it("sends `account` only in multi-account mode", async () => {
    const s = new SignalSurface({ daemonUrl: url, account: "+15550001111", multiAccount: true })
    await s.send("signal:+15552223333", { text: "hi" })
    expect((sent.at(-1) as { params: Record<string, unknown> }).params.account).toBe("+15550001111")
  })
  it("Note to Self: sync sentMessage to self counts only in noteToSelf mode; replies go noteToSelf and are not re-ingested", async () => {
    const me = "+15550001111"
    const sync = {
      method: "receive",
      params: {
        envelope: {
          source: me,
          sourceNumber: me,
          syncMessage: {
            sentMessage: {
              destination: me,
              destinationNumber: me,
              timestamp: 42,
              message: "balance?",
            },
          },
        },
      },
    }
    expect(inboundOf(sync, me)).toBeNull()
    expect(inboundOf(sync, me, true)).toEqual({
      userId: `signal:${me}`,
      text: "balance?",
      messageId: "42",
    })
    const toOther = {
      ...sync,
      params: {
        envelope: {
          ...sync.params.envelope,
          syncMessage: { sentMessage: { destinationNumber: "+15559990000", message: "hi friend" } },
        },
      },
    }
    expect(inboundOf(toOther, me, true)).toBeNull()
    const got: InboundMessage[] = []
    const s = new SignalSurface({ daemonUrl: url, account: me, noteToSelf: true })
    await s.start(async (m) => {
      got.push(m)
    })
    for (let i = 0; i < 50 && !pushEvent; i++) await new Promise((r) => setTimeout(r, 20))
    await s.send(`signal:${me}`, { text: "Your wallet holds 250,000 sats." })
    expect((sent.at(-1) as { params: Record<string, unknown> }).params).toEqual({
      noteToSelf: true,
      message: "Your wallet holds 250,000 sats.",
    })
    const push = pushEvent as (o: unknown) => void
    push({
      method: "receive",
      params: {
        envelope: {
          sourceNumber: me,
          syncMessage: {
            sentMessage: { destinationNumber: me, message: "Your wallet holds 250,000 sats." },
          },
        },
      },
    })
    push({
      method: "receive",
      params: {
        envelope: {
          sourceNumber: me,
          syncMessage: {
            sentMessage: { destinationNumber: me, message: "pay 500 sats to gm@getalby.com" },
          },
        },
      },
    })
    for (let i = 0; i < 50 && got.length < 1; i++) await new Promise((r) => setTimeout(r, 20))
    expect(got.map((g) => g.text)).toEqual(["pay 500 sats to gm@getalby.com"])
    await s.stop()
  })
  it("inboundOf handles both documented shapes and rejects empty messages", () => {
    expect(
      inboundOf(
        {
          method: "receive",
          params: { envelope: { source: "+1", dataMessage: { message: "x" } } },
        },
        "+9",
      ),
    ).toMatchObject({ userId: "signal:+1", text: "x" })
    expect(
      inboundOf({ envelope: { sourceNumber: "+1", dataMessage: { message: "x" } } }, "+9"),
    ).toMatchObject({ userId: "signal:+1" })
    expect(
      inboundOf(
        { params: { envelope: { sourceNumber: "+1", dataMessage: { message: null } } } },
        "+9",
      ),
    ).toBeNull()
    expect(
      inboundOf(
        { params: { envelope: { sourceNumber: "+1", dataMessage: { message: "   " } } } },
        "+9",
      ),
    ).toBeNull()
  })
  it("parseSse splits events across chunk boundaries and skips keepalives", async () => {
    const enc = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(': keepalive\n\ndata:{"a":1}\n\nda'))
        c.enqueue(enc.encode('ta:{"b":2}\n\nevent:x\ndata:{"c":3}\n\n'))
        c.close()
      },
    })
    const out: unknown[] = []
    for await (const ev of parseSse(stream)) out.push(ev)
    expect(out).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }])
  })
})
