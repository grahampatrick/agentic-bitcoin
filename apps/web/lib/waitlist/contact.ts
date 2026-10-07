/** Pure contact helpers. No I/O. A contact is an email address or a Nostr public key (npub). */

export type ContactKind = "email" | "npub"

/** Pragmatic email check — reject obvious junk, don't adjudicate exotic-but-legal addresses. */
export function isValidEmail(email: string): boolean {
  if (email.length < 3 || email.length > 254) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
}

/** NIP-19 npub: bech32, 58 data chars after `npub1`. We check shape, not the checksum. */
export function isValidNpub(npub: string): boolean {
  return /^npub1[02-9ac-hj-np-z]{58}$/.test(npub)
}

/** Trim + lowercase so variants dedupe to one row. */
export function normalizeContact(raw: string): string {
  return raw.trim().toLowerCase()
}

export function classifyContact(normalized: string): ContactKind | null {
  if (isValidNpub(normalized)) return "npub"
  if (isValidEmail(normalized)) return "email"
  return null
}
