/**
 * LND REST on-chain rail (M8): the user's own node (Start9/Umbrel/raw lnd) with a macaroon baked
 * for ONLY `onchain:read` + `onchain:write`. Never a full admin macaroon.
 *
 *   GET  /v1/balance/blockchain          → { confirmed_balance, unconfirmed_balance } (sat strings)
 *   POST /v1/transactions                 { addr, amount, sat_per_vbyte, label } → { txid }
 * Header: Grpc-Metadata-macaroon: <hex>. Self-signed TLS: pass `tlsCertPem` or run behind a trusted proxy.
 */
import { type OnChainRail, RailError, type Sats } from "@agentic-bitcoin/core"

export interface LndConfig {
  baseUrl: string
  /** Hex-encoded macaroon with onchain:read + onchain:write only. */
  macaroonHex: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  /** Default fee rate when the action does not specify one. */
  defaultSatPerVbyte?: number
}

export class LndOnChainRail implements OnChainRail {
  readonly kind = "lnd-onchain"
  private readonly base: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly sent = new Map<string, { txid: string; feeSats: Sats }>()

  constructor(private readonly cfg: LndConfig) {
    if (!cfg.baseUrl || !/^[0-9a-f]+$/i.test(cfg.macaroonHex ?? ""))
      throw new RailError(
        "lnd-onchain",
        "BAD_CONFIG",
        "LND baseUrl and a hex macaroon are required",
      )
    this.base = cfg.baseUrl.replace(/\/$/, "")
    this.fetchImpl = cfg.fetchImpl ?? fetch
    this.timeoutMs = cfg.timeoutMs ?? 20_000
  }

  async getBalance(): Promise<{ confirmedSats: Sats; unconfirmedSats: Sats }> {
    const r = (await this.call("GET", "/v1/balance/blockchain")) as {
      confirmed_balance?: string
      unconfirmed_balance?: string
    }
    return {
      confirmedSats: toSats(r.confirmed_balance),
      unconfirmedSats: toSats(r.unconfirmed_balance),
    }
  }

  async send(input: {
    address: string
    amountSats: Sats
    satPerVbyte?: number
    idempotencyKey: string
  }): Promise<{ txid: string; feeSats: Sats }> {
    const prior = this.sent.get(input.idempotencyKey)
    if (prior) return prior
    if (input.amountSats <= 0n)
      throw new RailError(this.kind, "AMOUNT_OUT_OF_RANGE", "amount must be > 0")
    const satPerVbyte = input.satPerVbyte ?? this.cfg.defaultSatPerVbyte ?? 2
    const before = await this.getBalance()
    const r = (await this.call("POST", "/v1/transactions", {
      addr: input.address,
      amount: input.amountSats.toString(),
      sat_per_vbyte: satPerVbyte,
      label: `agentic-bitcoin ${input.idempotencyKey}`.slice(0, 500),
    })) as { txid?: string }
    if (!r.txid) throw new RailError(this.kind, "BAD_RESPONSE", "no txid in response")
    // LND reports no fee on this endpoint; derive it from the balance delta (unconfirmed change counts).
    const after = await this.getBalance()
    const total =
      before.confirmedSats + before.unconfirmedSats - (after.confirmedSats + after.unconfirmedSats)
    const feeSats = total > input.amountSats ? total - input.amountSats : 0n
    const out = { txid: r.txid, feeSats }
    this.sent.set(input.idempotencyKey, out)
    return out
  }

  private async call(method: string, path: string, body?: unknown): Promise<unknown> {
    let res: Response
    try {
      res = await this.fetchImpl(`${this.base}${path}`, {
        method,
        headers: {
          "grpc-metadata-macaroon": this.cfg.macaroonHex,
          accept: "application/json",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (err) {
      throw new RailError(this.kind, "UNREACHABLE", `lnd ${path}: ${(err as Error).message}`)
    }
    const text = await res.text()
    let parsed: { message?: string; error?: string; code?: number } | null = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = null
    }
    if (res.ok) return parsed ?? {}
    const msg = parsed?.message ?? parsed?.error ?? text.slice(0, 200)
    if (res.status === 401 || res.status === 403 || /permission denied|macaroon/i.test(msg))
      throw new RailError(this.kind, "UNAUTHORIZED", `lnd: ${msg}`)
    if (/insufficient funds/i.test(msg))
      throw new RailError(this.kind, "INSUFFICIENT_FUNDS", `lnd: ${msg}`)
    if (/invalid address|decode address/i.test(msg))
      throw new RailError(this.kind, "REJECTED", `lnd: ${msg}`)
    throw new RailError(
      this.kind,
      res.status >= 500 ? "UNREACHABLE" : "REJECTED",
      `lnd ${res.status}: ${msg}`,
    )
  }
}

function toSats(v: string | undefined): Sats {
  if (v === undefined || !/^\d+$/.test(v)) return 0n
  return BigInt(v)
}
