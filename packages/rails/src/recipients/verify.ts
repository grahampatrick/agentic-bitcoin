/**
 * Recipient verification (M9, ADR-0013). Two facts, both cheap and both from the recipient's own
 * infrastructure: (1) the Lightning address answers LNURL-pay at `https://<domain>/.well-known/lnurlp/<name>`;
 * (2) when the recipient's website is on the same domain as the address, the address is theirs —
 * "domain" verification. Otherwise the operator vouches ("operator"). Nothing is paid.
 */
import { type Recipient, type Sats, isLightningAddress } from "@agentic-bitcoin/core"

export type AddressProbe =
  | { ok: true; domain: string; minSats: Sats; maxSats: Sats; description?: string }
  | { ok: false; error: string }

type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
}>

/** GET the LNURL-pay metadata for a Lightning address. Never sends money. */
export async function probeLightningAddress(
  address: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  timeoutMs = 6000,
): Promise<AddressProbe> {
  const a = address.trim().toLowerCase()
  if (!isLightningAddress(a)) return { ok: false, error: "not a lightning address" }
  const [name, domain] = a.split("@") as [string, string]
  try {
    const res = await fetchImpl(
      `https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`,
      {
        signal: AbortSignal.timeout(timeoutMs),
      },
    )
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} from ${domain}` }
    const j = (await res.json()) as {
      tag?: string
      minSendable?: number
      maxSendable?: number
      metadata?: string
      status?: string
      reason?: string
    }
    if (j.status === "ERROR") return { ok: false, error: j.reason ?? "LNURL error" }
    if (
      j.tag !== "payRequest" ||
      typeof j.minSendable !== "number" ||
      typeof j.maxSendable !== "number"
    )
      return { ok: false, error: "not an LNURL-pay endpoint" }
    let description: string | undefined
    try {
      const meta = JSON.parse(j.metadata ?? "[]") as [string, string][]
      description = meta.find((m) => m[0] === "text/plain")?.[1]
    } catch {
      /* metadata is optional for us */
    }
    return {
      ok: true,
      domain,
      minSats: BigInt(Math.ceil(j.minSendable / 1000)), // money-ok: LNURL msats → sats at the boundary
      maxSats: BigInt(Math.floor(j.maxSendable / 1000)), // money-ok: LNURL msats → sats at the boundary
      description,
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/** "domain" when the recipient's website lives on the address's domain (or a subdomain of it). */
export function verificationFor(
  r: Pick<Recipient, "lightningAddress" | "website">,
  probe: AddressProbe,
  now: () => Date = () => new Date(),
): Recipient["verified"] {
  if (!probe.ok) return null
  if (!r.website) return null
  let host: string
  try {
    host = new URL(r.website).hostname.toLowerCase()
  } catch {
    return null
  }
  const d = probe.domain
  if (host === d || host.endsWith(`.${d}`) || d.endsWith(`.${host}`))
    return { how: "domain", at: now().toISOString() }
  return null
}
