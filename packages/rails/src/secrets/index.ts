/**
 * Secrets at rest (NWC connection strings, exchange and merchant API keys).
 *
 * AES-256-GCM via node:crypto — no dependency, authenticated, random 96-bit IV per value.
 * Format: `v1.<iv b64url>.<tag b64url>.<ciphertext b64url>`. The key comes from
 * `SECRETS_KEY` (32 bytes, hex or base64) and is never stored next to the data.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

export class SecretsError extends Error {
  readonly code: "BAD_KEY" | "BAD_CIPHERTEXT" | "TAMPERED"
  constructor(code: SecretsError["code"], message: string) {
    super(message)
    this.name = "SecretsError"
    this.code = code
  }
}

export function parseKey(raw: string | undefined): Buffer {
  if (!raw) throw new SecretsError("BAD_KEY", "SECRETS_KEY is not set")
  const trimmed = raw.trim()
  const buf = /^[0-9a-f]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64")
  if (buf.length !== 32)
    throw new SecretsError("BAD_KEY", "SECRETS_KEY must be 32 bytes (64 hex chars or base64)")
  return buf
}

export function generateKeyHex(): string {
  return randomBytes(32).toString("hex")
}

export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return ["v1", b64(iv), b64(tag), b64(ct)].join(".")
}

export function decryptSecret(blob: string, key: Buffer): string {
  const parts = blob.split(".")
  if (parts.length !== 4 || parts[0] !== "v1")
    throw new SecretsError("BAD_CIPHERTEXT", "not a v1 secret blob")
  const [, ivS, tagS, ctS] = parts as [string, string, string, string]
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivS, "base64url"))
    decipher.setAuthTag(Buffer.from(tagS, "base64url"))
    return Buffer.concat([
      decipher.update(Buffer.from(ctS, "base64url")),
      decipher.final(),
    ]).toString("utf8")
  } catch {
    throw new SecretsError("TAMPERED", "secret failed authentication (wrong key or modified)")
  }
}

/** For logs and UI: show only enough to recognise which secret it is. */
export function maskSecret(plain: string): string {
  if (plain.length <= 8) return "••••"
  return `${plain.slice(0, 4)}…${plain.slice(-4)}`
}

function b64(b: Buffer): string {
  return b.toString("base64url")
}
