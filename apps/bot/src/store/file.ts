/**
 * File-backed stores for a single-operator setup (no Supabase): one JSON file under apps/bot/.data.
 * Secrets are stored as the same encrypted blobs the memory/Supabase stores hold; the file never
 * contains a plaintext connection string or key. Not for multi-user production — Supabase is.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import type { LlmMessage } from "@agentic-bitcoin/agent"
import type { Policy } from "@agentic-bitcoin/core"
import type { HistoryStore, PolicyStore, SecretName, SecretStore } from "./stores"

type Shape = {
  policies: Record<string, string>
  secrets: Record<string, string>
  history: Record<string, string>
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
      : { policies: {}, secrets: {}, history: {} }
    this.data.policies ??= {}
    this.data.secrets ??= {}
    this.data.history ??= {}
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
