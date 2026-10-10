/**
 * File-backed stores for a single-operator setup (no Supabase): one JSON file under apps/bot/.data.
 * Secrets are stored as the same encrypted blobs the memory/Supabase stores hold; the file never
 * contains a plaintext connection string or key. Not for multi-user production — Supabase is.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import type { LlmMessage } from "@agentic-bitcoin/agent"
import {
  type Policy,
  type Recipient,
  type RecipientStore,
  SLUG_RE,
  recipientMatches,
} from "@agentic-bitcoin/core"
import type { HistoryStore, PolicyStore, SecretName, SecretStore } from "./stores"

type Shape = {
  policies: Record<string, string>
  secrets: Record<string, string>
  history: Record<string, string>
  recipients: Record<string, string>
  campaigns: Record<string, string>
  shop: Record<string, string>
}

const enc = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `${x}n` : x))
const dec = <T>(s: string): T =>
  JSON.parse(s, (_k, x) =>
    typeof x === "string" && /^\d+n$/.test(x) ? BigInt(x.slice(0, -1)) : x,
  ) as T

export class FileState {
  private data: Shape
  constructor(private readonly path: string) {
    this.data = existsSync(path)
      ? (JSON.parse(readFileSync(path, "utf8")) as Shape)
      : { policies: {}, secrets: {}, history: {}, recipients: {}, campaigns: {}, shop: {} }
    this.data.policies ??= {}
    this.data.secrets ??= {}
    this.data.history ??= {}
    this.data.recipients ??= {}
    this.data.campaigns ??= {}
    this.data.shop ??= {}
  }
  keys(bucket: keyof Shape): string[] {
    return Object.keys(this.data[bucket])
  }
  get(bucket: keyof Shape, key: string): string | null {
    return (this.data[bucket] as Record<string, string>)[key] ?? null
  }
  set(bucket: keyof Shape, key: string, value: string | null): void {
    const b = this.data[bucket] as Record<string, string>
    if (value === null) delete b[key]
    else b[key] = value
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 })
    renameSync(tmp, this.path)
  }
}

export class FilePolicyStore implements PolicyStore {
  constructor(private readonly f: FileState) {}
  async get(u: string) {
    const v = this.f.get("policies", u)
    return v ? dec<Policy>(v) : null
  }
  async set(u: string, p: Policy) {
    this.f.set("policies", u, enc(p))
  }
}

export class FileSecretStore implements SecretStore {
  constructor(private readonly f: FileState) {}
  async get(u: string, n: SecretName) {
    return this.f.get("secrets", `${u}:${n}`)
  }
  async set(u: string, n: SecretName, blob: string) {
    this.f.set("secrets", `${u}:${n}`, blob)
  }
  async delete(u: string, n: SecretName) {
    this.f.set("secrets", `${u}:${n}`, null)
  }
}

export class FileHistoryStore implements HistoryStore {
  constructor(private readonly f: FileState) {}
  async get(u: string) {
    const v = this.f.get("history", u)
    return v ? (JSON.parse(v) as LlmMessage[]) : []
  }
  async set(u: string, h: LlmMessage[]) {
    this.f.set("history", u, JSON.stringify(h))
  }
}

/** Directory + private recipients in the same file; visibility is enforced here, not by callers. */
export class FileRecipientStore implements RecipientStore {
  readonly kind = "file"
  constructor(private readonly f: FileState) {}
  private all(): Recipient[] {
    return this.f.keys("recipients").map((k) => dec<Recipient>(this.f.get("recipients", k) ?? ""))
  }
  private visible(r: Recipient, userId?: string) {
    return !r.ownerUserId || (userId !== undefined && r.ownerUserId === userId)
  }
  async get(slug: string, userId?: string) {
    const v = this.f.get("recipients", slug.toLowerCase())
    if (!v) return null
    const r = dec<Recipient>(v)
    return this.visible(r, userId) ? r : null
  }
  async search(query: string, userId?: string) {
    return this.all().filter((r) => this.visible(r, userId) && recipientMatches(r, query))
  }
  async list(userId?: string) {
    return this.all().filter((r) => this.visible(r, userId))
  }
  async upsert(r: Recipient) {
    if (!SLUG_RE.test(r.slug)) throw new Error(`bad slug: ${r.slug}`)
    this.f.set("recipients", r.slug, enc(r))
  }
  async remove(slug: string) {
    this.f.set("recipients", slug, null)
  }
}
