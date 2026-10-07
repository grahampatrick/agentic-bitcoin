import { afterEach, describe, expect, it } from "vitest"
import { classifyContact, isValidEmail, isValidNpub, normalizeContact } from "./contact"
import { WaitlistError } from "./errors"
import { __resetWaitlistStore, getWaitlistStore, joinWaitlist } from "./service"
import { InMemoryWaitlistStore } from "./store"

const fixedNow = () => new Date("2026-10-07T12:00:00.000Z")
const NPUB = "npub1sn0wdenkukak0d9dfczzeacvhkrgz92ak56egt7vdgzn8pv2wfqqhrjdv9"

describe("contact helpers", () => {
  it.each(["me@example.com", "a.b@school.org", "x+y@sub.domain.io"])("accepts email %s", (e) => {
    expect(isValidEmail(e)).toBe(true)
  })
  it.each(["", "nope", "no@domain", "a@b.c d", "@example.com", "x@x."])("rejects email %j", (e) => {
    expect(isValidEmail(e)).toBe(false)
  })
  it("accepts a well-formed npub and rejects malformed ones", () => {
    expect(isValidNpub(NPUB)).toBe(true)
    expect(isValidNpub("npub1short")).toBe(false)
    expect(isValidNpub(`${NPUB}x`)).toBe(false)
    expect(isValidNpub("nsec1sn0wdenkukak0d9dfczzeacvhkrgz92ak56egt7vdgzn8pv2wfqqhrjdv9")).toBe(
      false,
    )
  })
  it("classifies after normalizing", () => {
    expect(classifyContact(normalizeContact("  Me@Example.COM "))).toBe("email")
    expect(classifyContact(normalizeContact(` ${NPUB.toUpperCase()} `))).toBe("npub")
    expect(classifyContact("junk")).toBeNull()
  })
})

describe("joinWaitlist", () => {
  it("stores a valid email", async () => {
    const store = new InMemoryWaitlistStore()
    const result = await joinWaitlist({ contact: "new@example.com", now: fixedNow }, store)
    expect(result).toEqual({ ok: true, created: true, kind: "email", storeKind: "memory" })
    expect(await store.has("new@example.com")).toBe(true)
  })
  it("stores a valid npub", async () => {
    const store = new InMemoryWaitlistStore()
    const result = await joinWaitlist({ contact: NPUB, source: "text", now: fixedNow }, store)
    expect(result.kind).toBe("npub")
    expect(await store.count()).toBe(1)
  })
  it("rejects junk with a typed 400", async () => {
    const store = new InMemoryWaitlistStore()
    await expect(
      joinWaitlist({ contact: "not-a-contact", now: fixedNow }, store),
    ).rejects.toMatchObject({
      code: "INVALID_CONTACT",
      status: 400,
    })
    expect(await store.count()).toBe(0)
  })
  it("rejects a duplicate with a typed 409 and does not double-store", async () => {
    const store = new InMemoryWaitlistStore()
    await joinWaitlist({ contact: "dup@example.com", now: fixedNow }, store)
    await expect(
      joinWaitlist({ contact: "  DUP@example.com ", now: fixedNow }, store),
    ).rejects.toBeInstanceOf(WaitlistError)
    expect(await store.count()).toBe(1)
  })
})

describe("getWaitlistStore (env-based selection)", () => {
  const originalUrl = process.env.SUPABASE_URL
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  afterEach(() => {
    __resetWaitlistStore()
    if (originalUrl === undefined) delete process.env.SUPABASE_URL
    else process.env.SUPABASE_URL = originalUrl
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey
  })
  it("falls back to memory when env is absent", () => {
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    __resetWaitlistStore()
    expect(getWaitlistStore().kind).toBe("memory")
  })
  it("selects Supabase when both vars are present", () => {
    process.env.SUPABASE_URL = "https://example.supabase.co"
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key"
    __resetWaitlistStore()
    expect(getWaitlistStore().kind).toBe("supabase")
  })
})
