/**
 * M23 — the workspace (ADR-0027). Chat is the key; the web is a window onto the same stores.
 *
 * - Per-user stores the bot has always had (policy, sealed secrets) now live here so the web can
 *   read the same rows. Secrets cross this boundary only as encrypted blobs; the web never holds
 *   SECRETS_KEY and only ever asks "is one set?".
 * - A web link is a long random token the bot hands a user in chat (`/web`). The store keeps its
 *   hash and an expiry, never the token. Presenting the token opens `/me`; `/web revoke` or
 *   "Log out everywhere" removes every link.
 * - `patchPolicy` is the one pure way a form may change limits, rails, the kill switch and the
 *   allow/deny lists, so chat and web enforce the same rules.
 */
import { createHash } from "node:crypto"
import type { Policy } from "./policy"

// ---------------------------------------------------------------------------------------------
// Per-user stores (interfaces shared by bot and web)

export interface PolicyStore {
  get(userId: string): Promise<Policy | null>
  set(userId: string, policy: Policy): Promise<void>
}

export type SecretName = "nwc" | "strike" | "bitrefill"

export interface SecretStore {
  /** Returns the encrypted blob; the caller decrypts with SECRETS_KEY. */
  get(userId: string, name: SecretName): Promise<string | null>
  set(userId: string, name: SecretName, blob: string): Promise<void>
  delete(userId: string, name: SecretName): Promise<void>
}

export class InMemoryPolicyStore implements PolicyStore {
  private readonly m = new Map<string, Policy>()
  async get(u: string) {
    return this.m.get(u) ?? null
  }
  async set(u: string, p: Policy) {
    this.m.set(u, p)
  }
}

export class InMemorySecretStore implements SecretStore {
  private readonly m = new Map<string, string>()
  async get(u: string, n: SecretName) {
    return this.m.get(`${u}:${n}`) ?? null
  }
  async set(u: string, n: SecretName, b: string) {
    this.m.set(`${u}:${n}`, b)
  }
  async delete(u: string, n: SecretName) {
    this.m.delete(`${u}:${n}`)
  }
}

// ---------------------------------------------------------------------------------------------
// Web links

export interface WebLink {
  tokenHash: string
  userId: string
  createdAt: string
  expiresAt: string
}

export interface WebLinkStore {
  readonly kind: string
  /** The user a token hash opens, or null when unknown or expired. */
  userFor(tokenHash: string, now: Date): Promise<string | null>
  create(link: WebLink): Promise<void>
  listForUser(userId: string): Promise<WebLink[]>
  revoke(tokenHash: string): Promise<void>
  revokeAll(userId: string): Promise<void>
}

export const WEB_LINK_TTL_DAYS = 30
export const WEB_TOKEN_BYTES = 24

/** A token from random bytes: base64url, no padding. 24 bytes → 32 characters. */
export function newWebToken(bytes: Uint8Array): string {
  if (bytes.length < 16) throw new Error("web token needs at least 16 random bytes")
  return Buffer.from(bytes).toString("base64url")
}

export function hashWebToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export function webLinkExpiry(now: Date, ttlDays = WEB_LINK_TTL_DAYS): string {
  return new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString()
}

export function workspaceUrl(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/$/, "")}/me?t=${encodeURIComponent(token)}`
}

export class InMemoryWebLinkStore implements WebLinkStore {
  readonly kind = "memory"
  private readonly m = new Map<string, WebLink>()
  constructor(seed: WebLink[] = []) {
    for (const l of seed) this.m.set(l.tokenHash, l)
  }
  async userFor(tokenHash: string, now: Date) {
    const l = this.m.get(tokenHash)
    if (!l || l.expiresAt <= now.toISOString()) return null
    return l.userId
  }
  async create(link: WebLink) {
    this.m.set(link.tokenHash, link)
  }
  async listForUser(userId: string) {
    return [...this.m.values()]
      .filter((l) => l.userId === userId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
  }
  async revoke(tokenHash: string) {
    this.m.delete(tokenHash)
  }
  async revokeAll(userId: string) {
    for (const [k, l] of this.m) if (l.userId === userId) this.m.delete(k)
  }
}

// ---------------------------------------------------------------------------------------------
// Identity display

/** "signal:+13039952649" → { surface: "Signal", masked: "+1 ••• ••• 2649" }. Never the whole handle. */
export function describeIdentity(userId: string): { surface: string; masked: string } {
  const i = userId.indexOf(":")
  const surface = i > 0 ? userId.slice(0, i) : "chat"
  const handle = i > 0 ? userId.slice(i + 1) : userId
  const label = surface.charAt(0).toUpperCase() + surface.slice(1)
  if (/^\+\d{8,15}$/.test(handle)) {
    const cc = handle.slice(0, handle.length > 12 ? 3 : 2)
    return { surface: label, masked: `${cc} ••• ••• ${handle.slice(-4)}` }
  }
  return { surface: label, masked: `…${handle.slice(-4)}` }
}

// ---------------------------------------------------------------------------------------------
// Policy edits from a form

export interface PolicyPatch {
  dailyCapSats?: string | bigint
  perActionCapSats?: string | bigint
  confirmAboveSats?: string | bigint
  rails?: Partial<Policy["rails"]>
  killSwitch?: boolean
  allowAdd?: string
  allowRemove?: string
  denyAdd?: string
  denyRemove?: string
}

export type PatchResult = { ok: true; policy: Policy } | { ok: false; error: string }

const MAX_SATS = 1_000_000_000_000n // money-ok: a bound on a form field, not money
const DEST_RE = /^[a-z0-9*._+@-]{3,120}$/i

function sats(v: string | bigint | undefined, label: string): bigint | undefined | Error {
  if (v === undefined) return undefined
  if (typeof v === "bigint") return v
  const t = v.trim().replace(/[,_\s]/g, "")
  if (!/^\d{1,13}$/.test(t)) return new Error(`${label} must be a whole number of sats`)
  const n = BigInt(t)
  if (n > MAX_SATS) return new Error(`${label} is too large`)
  return n
}

/** Apply a form's changes to a policy, or say why not. Pure. */
export function patchPolicy(p: Policy, patch: PolicyPatch): PatchResult {
  let next: Policy = { ...p, rails: { ...p.rails } }
  for (const [key, label] of [
    ["dailyCapSats", "Daily cap"],
    ["perActionCapSats", "Per-action cap"],
    ["confirmAboveSats", "Confirm above"],
  ] as const) {
    const v = sats(patch[key], label)
    if (v instanceof Error) return { ok: false, error: v.message }
    if (v !== undefined) next = { ...next, [key]: v }
  }
  if (next.dailyCapSats <= 0n || next.perActionCapSats <= 0n)
    return { ok: false, error: "Caps must be above zero" }
  if (next.perActionCapSats > next.dailyCapSats)
    return { ok: false, error: "The per-action cap cannot exceed the daily cap" }
  if (patch.rails) {
    for (const k of Object.keys(patch.rails) as (keyof Policy["rails"])[]) {
      if (!(k in next.rails)) return { ok: false, error: `Unknown rail ${k}` }
      next.rails[k] = !!patch.rails[k]
    }
  }
  if (patch.killSwitch !== undefined) next = { ...next, killSwitch: !!patch.killSwitch }
  const dest = (v: string | undefined, label: string) => {
    if (v === undefined) return undefined
    const t = v.trim().toLowerCase()
    if (!DEST_RE.test(t)) return new Error(`${label} must be a Lightning address or a pattern`)
    return t
  }
  for (const [key, list, label] of [
    ["allowAdd", "allowDestinations", "Trusted destination"],
    ["denyAdd", "denyDestinations", "Blocked destination"],
  ] as const) {
    const v = dest(patch[key], label)
    if (v instanceof Error) return { ok: false, error: v.message }
    if (v !== undefined && !next[list].includes(v)) next = { ...next, [list]: [...next[list], v] }
  }
  for (const [key, list] of [
    ["allowRemove", "allowDestinations"],
    ["denyRemove", "denyDestinations"],
  ] as const) {
    const v = patch[key]?.trim().toLowerCase()
    if (v) next = { ...next, [list]: next[list].filter((d) => d !== v) }
  }
  return { ok: true, policy: next }
}
