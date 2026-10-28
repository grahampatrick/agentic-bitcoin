import { ACTIONS, NOW } from "@agentic-bitcoin/fixtures"
import { describe, expect, it } from "vitest"
import {
  InMemoryLedgerStore,
  type LedgerEvent,
  NOTE_MAX,
  findByIdempotencyKey,
  findNoteTarget,
  foldEntries,
  noteEvent,
  readEntries,
  spentSince,
} from "./ledger"

const allow = { type: "allow" as const, summary: "s" }
const deny = { type: "deny" as const, reason: "DAILY_CAP" as const, summary: "s" }
const confirm = { type: "needs_confirmation" as const, summary: "s", actionHash: "h" }

describe("foldEntries", () => {
  it("derives outcome from the decision and later events", () => {
    const events: LedgerEvent[] = [
      { type: "requested", id: "a", at: NOW, action: ACTIONS.tip, decision: allow },
      { type: "requested", id: "b", at: NOW, action: ACTIONS.payFriend, decision: deny },
      { type: "requested", id: "c", at: NOW, action: ACTIONS.giftCard, decision: confirm },
      { type: "started", id: "a", at: NOW },
      { type: "succeeded", id: "a", at: NOW, preimage: "p" },
    ]
    const [a, b, c] = foldEntries(events)
    expect(a).toMatchObject({ outcome: "succeeded", preimage: "p", resolvedAt: NOW })
    expect(b?.outcome).toBe("denied")
    expect(c?.outcome).toBe("awaiting_confirmation")
  })
  it("records failures and ignores orphan events", () => {
    const events: LedgerEvent[] = [
      { type: "failed", id: "ghost", at: NOW, error: "x" },
      { type: "requested", id: "a", at: NOW, action: ACTIONS.tip, decision: allow },
      { type: "failed", id: "a", at: NOW, error: "boom" },
    ]
    const entries = foldEntries(events)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ outcome: "failed", error: "boom" })
  })
})

describe("spentSince", () => {
  const mk = (id: string, at: string, outcomeEvent?: LedgerEvent): LedgerEvent[] => [
    { type: "requested", id, at, action: { ...ACTIONS.tip, idempotencyKey: id }, decision: allow },
    ...(outcomeEvent ? [outcomeEvent] : []),
  ]
  it("counts succeeded and pending, not denied/failed/awaiting", () => {
    const events: LedgerEvent[] = [
      ...mk("ok", NOW, { type: "succeeded", id: "ok", at: NOW }),
      ...mk("inflight", NOW),
      ...mk("bad", NOW, { type: "failed", id: "bad", at: NOW, error: "x" }),
      { type: "requested", id: "no", at: NOW, action: ACTIONS.payFriend, decision: deny },
      { type: "requested", id: "wait", at: NOW, action: ACTIONS.giftCard, decision: confirm },
    ]
    expect(spentSince(foldEntries(events), "2026-10-07T00:00:00.000Z")).toBe(42n)
  })
  it("ignores entries before the window start", () => {
    const events = [
      ...mk("old", "2026-10-06T11:59:59.000Z", { type: "succeeded", id: "old", at: NOW }),
      ...mk("new", NOW, { type: "succeeded", id: "new", at: NOW }),
    ]
    expect(spentSince(foldEntries(events), "2026-10-06T12:00:00.000Z")).toBe(21n)
  })
  it("budgets exchange buys by their sats estimate", () => {
    const events: LedgerEvent[] = [
      { type: "requested", id: "d", at: NOW, action: ACTIONS.dca, decision: allow },
      { type: "succeeded", id: "d", at: NOW },
    ]
    expect(spentSince(foldEntries(events), NOW)).toBe(30_050n)
  })
})

describe("InMemoryLedgerStore", () => {
  it("appends and reads back in order, filtered by since", async () => {
    const s = new InMemoryLedgerStore()
    await s.append({
      type: "requested",
      id: "1",
      at: "2026-10-07T10:00:00.000Z",
      action: ACTIONS.tip,
      decision: allow,
    })
    await s.append({
      type: "requested",
      id: "2",
      at: NOW,
      action: ACTIONS.balance,
      decision: allow,
    })
    expect((await s.events()).map((e) => e.id)).toEqual(["1", "2"])
    expect((await s.events(NOW)).map((e) => e.id)).toEqual(["2"])
    expect(findByIdempotencyKey(await readEntries(s), "k-tip-1")?.id).toBe("1")
    expect(findByIdempotencyKey(await readEntries(s), "nope")).toBeUndefined()
  })
})

describe("private notes (M21)", () => {
  it("noteEvent seals when it can, trims, and clears on empty text", () => {
    expect(noteEvent("a", NOW, "  hi  ")).toEqual({ type: "noted", id: "a", at: NOW, note: "hi" })
    expect(noteEvent("a", NOW, "hi", (s) => `s:${s}`)).toEqual({
      type: "noted",
      id: "a",
      at: NOW,
      sealed: "s:hi",
    })
    expect(noteEvent("a", NOW, "   ")).toEqual({ type: "noted", id: "a", at: NOW })
    expect((noteEvent("a", NOW, "x".repeat(500)) as { note: string }).note).toHaveLength(NOTE_MAX)
  })
  it("folds the last noted event onto the entry and findNoteTarget picks the right payment", () => {
    const events: LedgerEvent[] = [
      { type: "requested", id: "a", at: NOW, action: ACTIONS.tip, decision: allow },
      { type: "succeeded", id: "a", at: NOW },
      { type: "requested", id: "b", at: NOW, action: ACTIONS.payFriend, decision: allow },
      { type: "requested", id: "c", at: NOW, action: ACTIONS.balance, decision: allow },
      { type: "noted", id: "a", at: NOW, note: "first" },
      { type: "noted", id: "a", at: NOW, sealed: "blob" },
    ]
    const entries = foldEntries(events)
    expect(entries[0]).toMatchObject({ note: undefined, noteSealed: "blob" })
    expect(findNoteTarget(entries, {})?.id).toBe("b") // most recent payment in flight; reads never
    expect(findNoteTarget(entries, { entryId: "a" })?.id).toBe("a")
    expect(findNoteTarget(entries, { match: ACTIONS.tip.address.toUpperCase() })?.id).toBe("a")
    expect(findNoteTarget(entries, { entryId: "c" })).toBeUndefined()
    expect(
      foldEntries([...events, { type: "noted", id: "a", at: NOW }])[0]?.noteSealed,
    ).toBeUndefined()
  })
})
