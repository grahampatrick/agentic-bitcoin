import { createHash } from "node:crypto"
import { type CardStore, type VirtualCard, periodEnd } from "@agentic-bitcoin/core"

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export interface CardPage {
  id: string
  name: string
  state: VirtualCard["state"]
  scope: readonly string[]
  monthlyCapSats: bigint
  spentSats: bigint
  resetsAt: string
  perActionCapSats?: bigint
  confirmAboveSats?: bigint
  /** The token checked out: the viewer may pause/resume. */
  canManage: boolean
}

/** The card's page. Without the right token only the name and state are shown (no numbers). */
export async function cardPage(
  store: CardStore,
  id: string,
  token: string | undefined,
  now = new Date(),
): Promise<CardPage | null> {
  const c = await store.get(id)
  if (!c || c.state === "closed") return null
  const ok = !!token && !!c.viewTokenHash && hashToken(token) === c.viewTokenHash
  return {
    id: c.id,
    name: c.name,
    state: c.state,
    scope: ok ? c.scope : [],
    monthlyCapSats: ok ? c.monthlyCapSats : 0n,
    spentSats: ok ? (c.spentSats ?? 0n) : 0n,
    resetsAt: periodEnd(c, now),
    perActionCapSats: ok ? c.perActionCapSats : undefined,
    confirmAboveSats: ok ? c.confirmAboveSats : undefined,
    canManage: ok,
  }
}

export async function setCardState(
  store: CardStore,
  id: string,
  token: string,
  op: "pause" | "resume",
): Promise<{ ok: true; state: VirtualCard["state"] } | { ok: false; error: string }> {
  const c = await store.get(id)
  if (!c || c.state === "closed") return { ok: false, error: "No such card." }
  if (!c.viewTokenHash || hashToken(token) !== c.viewTokenHash)
    return { ok: false, error: "Not authorized." }
  const state = op === "pause" ? "paused" : "active"
  await store.update({ ...c, state })
  return { ok: true, state }
}
