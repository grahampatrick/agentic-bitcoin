/**
 * L402 compute rail (ADR-0009): the generic "paid HTTP" primitive. The server answers 402 with
 * `WWW-Authenticate: L402 macaroon="…", invoice="…"`; the executor pays the invoice through the
 * wallet rail (policy first), then this rail retries with `Authorization: L402 <macaroon>:<preimage>`.
 *
 * This adapter never pays. It parses challenges, decodes the invoice so the executor can compare
 * the ask with the approved ceiling BEFORE any sats move, and caches credentials per host so
 * follow-up requests (polling, a second question) do not pay twice.
 */
import {
  type ComputeRail,
  type ComputeRequestInit,
  type ComputeResponse,
  type L402Challenge,
  RailError,
} from "@agentic-bitcoin/core"
import { decodeInvoice, parseL402 } from "@getalby/lightning-tools"

export interface L402Options {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  /** Bodies are read as text up to this many bytes; larger responses are truncated with a marker. */
  maxBodyBytes?: number
  /** How long a paid credential is reused for the same host. */
  credentialTtlMs?: number
  now?: () => Date
}

interface Credential {
  macaroon: string
  preimage: string
  expiresAt: number
}

export class L402ComputeRail implements ComputeRail {
  readonly kind = "l402"
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly maxBodyBytes: number
  private readonly ttlMs: number
  private readonly now: () => Date
  private readonly credentials = new Map<string, Credential>()

  constructor(opts: L402Options = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.timeoutMs = opts.timeoutMs ?? 30_000
    this.maxBodyBytes = opts.maxBodyBytes ?? 1_000_000
    this.ttlMs = opts.credentialTtlMs ?? 60 * 60 * 1000
    this.now = opts.now ?? (() => new Date())
  }

  async request(
    url: string,
    init: ComputeRequestInit = {},
  ): Promise<{ status: 402; challenge: L402Challenge } | ComputeResponse> {
    const host = hostOf(url)
    const cached = this.credentials.get(host)
    if (cached && cached.expiresAt > this.now().getTime()) {
      const res = await this.send(url, init, authHeader(cached))
      if (res.status !== 402) return res
      // The credential no longer works (expired caveat, consumed token): fall through to a fresh challenge.
      this.credentials.delete(host)
      return this.challengeOf(res)
    }
    const res = await this.send(url, init)
    if (res.status !== 402) return res
    return this.challengeOf(res)
  }

  async requestWithToken(
    url: string,
    token: { macaroon: string; preimage: string },
    init: ComputeRequestInit = {},
  ): Promise<ComputeResponse> {
    const res = await this.send(url, init, authHeader(token))
    if (res.status >= 200 && res.status < 300) {
      this.credentials.set(hostOf(url), { ...token, expiresAt: this.now().getTime() + this.ttlMs })
    }
    return res
  }

  /** Test/diagnostic hook: what we would send next time for this host, if anything. */
  cachedCredential(host: string): { macaroon: string; preimage: string } | null {
    const c = this.credentials.get(host)
    return c && c.expiresAt > this.now().getTime()
      ? { macaroon: c.macaroon, preimage: c.preimage }
      : null
  }

  private challengeOf(res: ComputeResponse): { status: 402; challenge: L402Challenge } {
    const header = res.headers["www-authenticate"]
    if (!header)
      throw new RailError(this.kind, "BAD_RESPONSE", "402 without a WWW-Authenticate header")
    return { status: 402, challenge: parseChallenge(header) }
  }

  private async send(
    url: string,
    init: ComputeRequestInit,
    authorization?: string,
  ): Promise<ComputeResponse> {
    const headers: Record<string, string> = {
      accept: "application/json, text/*;q=0.8, */*;q=0.5",
      ...(init.headers ?? {}),
    }
    if (authorization) headers.authorization = authorization
    let res: Response
    try {
      res = await this.fetchImpl(url, {
        method: init.method ?? "GET",
        headers,
        body: init.body,
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: "manual", // never follow a redirect with a credential attached
      })
    } catch (err) {
      throw new RailError(this.kind, "UNREACHABLE", `${hostOf(url)}: ${(err as Error).message}`)
    }
    const body = await readBounded(res, this.maxBodyBytes)
    const out: Record<string, string> = {}
    res.headers.forEach((v, k) => {
      out[k.toLowerCase()] = v
    })
    return { status: res.status, body, headers: out }
  }
}

export function authHeader(t: { macaroon: string; preimage: string }): string {
  return `L402 ${t.macaroon}:${t.preimage}`
}

/** Parse a WWW-Authenticate L402/LSAT header into a challenge with the decoded amount. */
export function parseChallenge(header: string): L402Challenge {
  let parsed: { token: string; invoice: string }
  try {
    parsed = parseL402(header)
  } catch (err) {
    throw new RailError(
      "l402",
      "BAD_RESPONSE",
      `unparseable L402 challenge: ${(err as Error).message}`,
    )
  }
  const decoded = decodeInvoice(parsed.invoice)
  if (!decoded)
    throw new RailError("l402", "BAD_RESPONSE", "L402 challenge carries an undecodable invoice")
  if (decoded.satoshi <= 0)
    throw new RailError("l402", "BAD_RESPONSE", "L402 challenge invoice has no amount")
  return { macaroon: parsed.token, invoice: parsed.invoice, amountSats: BigInt(decoded.satoshi) }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    throw new RailError("l402", "BAD_CONFIG", `not a URL: ${url}`)
  }
}

async function readBounded(res: Response, max: number): Promise<string> {
  if (!res.body) return ""
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      size += value.byteLength
      if (size >= max) {
        await reader.cancel()
        break
      }
    }
  }
  const text = new TextDecoder().decode(concat(chunks)).slice(0, max)
  return size >= max ? `${text}\n[truncated at ${max} bytes]` : text
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0))
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.byteLength
  }
  return out
}
