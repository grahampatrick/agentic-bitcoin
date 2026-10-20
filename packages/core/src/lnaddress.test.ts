import { describe, expect, it } from "vitest"
import { InMemoryLightningAddressStore, normalizeAddressName } from "./lnaddress"

describe("lightning address names", () => {
  it("normalises, rejects junk and reserved names", () => {
    expect(normalizeAddressName(" @Graham ")).toBe("graham")
    expect(normalizeAddressName("g.m_1-x")).toBe("g.m_1-x")
    expect(normalizeAddressName("a")).toBeNull()
    expect(normalizeAddressName("has space")).toBeNull()
    expect(normalizeAddressName("admin")).toBeNull()
    expect(normalizeAddressName("satoshi")).toBeNull()
  })
  it("one name per user is looked up both ways; names are unique", async () => {
    const s = new InMemoryLightningAddressStore()
    await s.create({ name: "graham", userId: "u1", nwcSealed: "blob", createdAt: "t" })
    expect((await s.getForUser("u1"))?.name).toBe("graham")
    expect((await s.get("GRAHAM"))?.userId).toBe("u1")
    await expect(s.create({ name: "graham", userId: "u2", createdAt: "t" })).rejects.toThrow()
  })
})
