import { describe, expect, it } from "vitest"
import {
  SecretsError,
  decryptSecret,
  encryptSecret,
  generateKeyHex,
  maskSecret,
  parseKey,
} from "./index"

const key = parseKey("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")

describe("secrets at rest", () => {
  it("round-trips and never repeats a ciphertext", () => {
    const plain = "nostr+walletconnect://abc?relay=wss://r&secret=def"
    const a = encryptSecret(plain, key)
    const b = encryptSecret(plain, key)
    expect(a).not.toBe(b)
    expect(a.startsWith("v1.")).toBe(true)
    expect(a).not.toContain("walletconnect")
    expect(decryptSecret(a, key)).toBe(plain)
    expect(decryptSecret(b, key)).toBe(plain)
  })
  it("detects tampering and wrong keys", () => {
    const blob = encryptSecret("hello", key)
    const parts = blob.split(".")
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]}.${parts[3]?.replace(/.$/, (c) => (c === "A" ? "B" : "A"))}`
    expect(() => decryptSecret(tampered, key)).toThrow(SecretsError)
    expect(() => decryptSecret(blob, parseKey(generateKeyHex()))).toThrow(SecretsError)
    expect(() => decryptSecret("nope", key)).toThrow(SecretsError)
  })
  it("parses hex and base64 keys, rejects bad ones", () => {
    expect(parseKey(generateKeyHex()).length).toBe(32)
    expect(parseKey(Buffer.alloc(32, 7).toString("base64")).length).toBe(32)
    expect(() => parseKey(undefined)).toThrow(SecretsError)
    expect(() => parseKey("short")).toThrow(SecretsError)
  })
  it("masks for display", () => {
    expect(maskSecret("sk_live_1234567890")).toBe("sk_l…7890")
    expect(maskSecret("tiny")).toBe("••••")
  })
})
