/**
 * Lightning addresses for paired users (M15): `name@anvard.ai` is a pointer to the user's OWN wallet.
 * Our LNURL endpoint asks that wallet (over the sealed connection the user paired) to mint each
 * invoice, or forwards to an address they already have. We never hold a sat on their behalf.
 */
export interface LightningAddressRecord {
  /** Lower-case local part: `[a-z0-9][a-z0-9._-]{1,31}` */
  name: string
  userId: string
  /** The user's paired NWC string, sealed with SECRETS_KEY (the same blob the bot stores). */
  nwcSealed?: string
  /** Instead of minting: forward to an address the user already has. */
  forwardTo?: string
  createdAt: string
}

export interface LightningAddressStore {
  readonly kind: string
  get(name: string): Promise<LightningAddressRecord | null>
  getForUser(userId: string): Promise<LightningAddressRecord | null>
  create(r: LightningAddressRecord): Promise<void>
  update(r: LightningAddressRecord): Promise<void>
  remove(name: string): Promise<void>
}

export const ADDRESS_NAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/
/** Names we keep: operational, impersonation-prone, or already routes. */
export const RESERVED_ADDRESS_NAMES = new Set([
  "admin",
  "administrator",
  "anvard",
  "api",
  "bitcoin",
  "bot",
  "give",
  "help",
  "info",
  "lightning",
  "mail",
  "noreply",
  "pay",
  "postmaster",
  "receive",
  "root",
  "satoshi",
  "shop",
  "support",
  "tip",
  "www",
])

export function normalizeAddressName(raw: string): string | null {
  const n = raw.trim().toLowerCase().replace(/^@/, "")
  if (!ADDRESS_NAME_RE.test(n) || RESERVED_ADDRESS_NAMES.has(n)) return null
  return n
}

export class InMemoryLightningAddressStore implements LightningAddressStore {
  readonly kind = "memory"
  readonly m = new Map<string, LightningAddressRecord>()
  async get(name: string) {
    return this.m.get(name.toLowerCase()) ?? null
  }
  async getForUser(userId: string) {
    return [...this.m.values()].find((r) => r.userId === userId) ?? null
  }
  async create(r: LightningAddressRecord) {
    if (this.m.has(r.name)) throw new Error("name taken")
    this.m.set(r.name, r)
  }
  async update(r: LightningAddressRecord) {
    this.m.set(r.name, r)
  }
  async remove(name: string) {
    this.m.delete(name)
  }
}
