import { createHash } from "node:crypto"
import { randomBytes } from "node:crypto"
import {
  CardError,
  type CardStore,
  type VirtualCard,
  WEB_OWNER_PREFIX,
  buildCard,
  isUnclaimed,
  periodEnd,
} from "@agentic-bitcoin/core"

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
  /** Made on the web and not yet attached to a chat user: it enforces nothing until claimed. */
  unclaimed: boolean
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
    unclaimed: isUnclaimed(c),
  }
}

/** What the store's card builder posts. Sats arrive as integer strings; blanks mean "not set". */
export interface NewCardForm {
  name?: string
  scope?: string[] | string
  monthlyCapSats?: string
  perActionCapSats?: string
  confirmAboveSats?: string
  resetDay?: string | number
}

export type CreateCardResult =
  | { ok: true; id: string; token: string; link: string }
  | { ok: false; error: string }

const intSats = (v: string | undefined, label: string): bigint | undefined => {
  const t = (v ?? "").trim().replace(/[,_\s]/g, "")
  if (!t) return undefined
  if (!/^\d{1,15}$/.test(t))
    throw new CardError("INVALID", `${label} must be a whole number of sats`)
  return BigInt(t)
}

/**
 * Creates a card from the store's web form. The owner is `web:<random>` until the person claims
 * it from chat, so a card made here cannot touch anyone's wallet by itself. The view token is
 * returned once, in the link.
 */
export async function createCardFromWeb(
  store: CardStore,
  form: NewCardForm,
  siteUrl: string,
  now = new Date(),
  random: () => string = () => randomBytes(16).toString("hex"),
): Promise<CreateCardResult> {
  try {
    const scope = (Array.isArray(form.scope) ? form.scope : (form.scope ?? "").split(","))
      .map((s) => s.trim())
      .filter(Boolean)
    const monthlyCapSats = intSats(form.monthlyCapSats, "The monthly limit")
    if (monthlyCapSats === undefined)
      throw new CardError("INVALID", "Give the card a monthly limit in sats.")
    const userId = `${WEB_OWNER_PREFIX}${random()}`
    const token = random()
    const card = buildCard(
      {
        name: form.name ?? "",
        scope,
        monthlyCapSats,
        perActionCapSats: intSats(form.perActionCapSats, "The per-payment limit"),
        confirmAboveSats: intSats(form.confirmAboveSats, "The ask-me-above threshold"),
        resetDay: Number(form.resetDay ?? 1),
      },
      userId,
      [],
      now,
      hashToken(token),
    )
    await store.create(card)
    return {
      ok: true,
      id: card.id,
      token,
      link: `${siteUrl.replace(/\/$/, "")}/card/${card.id}?t=${token}`,
    }
  } catch (err) {
    if (err instanceof CardError) return { ok: false, error: err.message }
    throw err
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
