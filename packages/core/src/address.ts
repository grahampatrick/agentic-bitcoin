/**
 * Bitcoin address validation (M8): bech32/bech32m (bc1…, tb1…, bcrt1…) and base58check (1…, 3…,
 * m/n/2… on testnet). Shape + checksum only; no network calls. Dependency-free.
 */
export type AddressNetwork = "mainnet" | "testnet" | "regtest"
export interface ParsedAddress {
  network: AddressNetwork
  kind: "p2pkh" | "p2sh" | "p2wpkh" | "p2wsh" | "p2tr" | "witness_unknown"
}

export class AddressError extends Error {
  readonly code = "ADDRESS"
  constructor(message: string) {
    super(message)
    this.name = "AddressError"
  }
}

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]

function polymod(values: number[]): number {
  let chk = 1
  for (const v of values) {
    const top = chk >>> 25
    chk = ((chk & 0x1ffffff) << 5) ^ v
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i] as number
  }
  return chk >>> 0
}
function hrpExpand(hrp: string): number[] {
  const out: number[] = []
  for (const c of hrp) out.push(c.charCodeAt(0) >>> 5)
  out.push(0)
  for (const c of hrp) out.push(c.charCodeAt(0) & 31)
  return out
}

function decodeBech32(addr: string): { hrp: string; version: number; program: number[] } {
  const lower = addr.toLowerCase()
  if (addr !== lower && addr !== addr.toUpperCase()) throw new AddressError("mixed case")
  const pos = lower.lastIndexOf("1")
  if (pos < 1 || pos + 7 > lower.length || lower.length > 90)
    throw new AddressError("bad bech32 layout")
  const hrp = lower.slice(0, pos)
  const data: number[] = []
  for (const c of lower.slice(pos + 1)) {
    const v = CHARSET.indexOf(c)
    if (v === -1) throw new AddressError("bad bech32 character")
    data.push(v)
  }
  const pm = polymod([...hrpExpand(hrp), ...data])
  const version = data[0] as number
  const expected = version === 0 ? 1 : 0x2bc830a3 // bech32 for v0, bech32m for v1+
  if (pm !== expected) throw new AddressError("bad bech32 checksum")
  // 5-bit → 8-bit
  const words = data.slice(1, -6)
  let acc = 0
  let bits = 0
  const program: number[] = []
  for (const w of words) {
    acc = (acc << 5) | w
    bits += 5
    while (bits >= 8) {
      bits -= 8
      program.push((acc >>> bits) & 0xff)
    }
  }
  if (bits >= 5 || (acc << (8 - bits)) & 0xff) throw new AddressError("bad padding")
  return { hrp, version, program }
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const { createHash } = await import("node:crypto")
  return new Uint8Array(createHash("sha256").update(bytes).digest())
}
async function decodeBase58Check(addr: string): Promise<{ version: number; payload: Uint8Array }> {
  let n = 0n
  for (const c of addr) {
    const v = B58.indexOf(c)
    if (v === -1) throw new AddressError("bad base58 character")
    n = n * 58n + BigInt(v)
  }
  const bytes: number[] = []
  while (n > 0n) {
    bytes.unshift(Number(n % 256n))
    n /= 256n
  }
  for (const c of addr) {
    if (c !== "1") break
    bytes.unshift(0)
  }
  if (bytes.length !== 25) throw new AddressError("bad base58 length")
  const body = new Uint8Array(bytes.slice(0, 21))
  const check = await sha256(await sha256(body))
  for (let i = 0; i < 4; i++)
    if (check[i] !== bytes[21 + i]) throw new AddressError("bad base58 checksum")
  return { version: bytes[0] as number, payload: body.slice(1) }
}

/** Throws AddressError for anything that is not a well-formed bitcoin address. */
export async function parseAddress(addr: string): Promise<ParsedAddress> {
  const a = addr.trim()
  if (/^(bc|tb|bcrt)1/i.test(a)) {
    const { hrp, version, program } = decodeBech32(a)
    const network: AddressNetwork = hrp === "bc" ? "mainnet" : hrp === "tb" ? "testnet" : "regtest"
    if (version === 0 && program.length === 20) return { network, kind: "p2wpkh" }
    if (version === 0 && program.length === 32) return { network, kind: "p2wsh" }
    if (version === 1 && program.length === 32) return { network, kind: "p2tr" }
    if (version === 0) throw new AddressError("bad v0 program length")
    if (program.length < 2 || program.length > 40)
      throw new AddressError("bad witness program length")
    return { network, kind: "witness_unknown" }
  }
  const { version } = await decodeBase58Check(a)
  if (version === 0x00) return { network: "mainnet", kind: "p2pkh" }
  if (version === 0x05) return { network: "mainnet", kind: "p2sh" }
  if (version === 0x6f) return { network: "testnet", kind: "p2pkh" }
  if (version === 0xc4) return { network: "testnet", kind: "p2sh" }
  throw new AddressError("unknown address version")
}
