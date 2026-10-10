import { describe, expect, it } from "vitest"
import { probeLightningAddress, verificationFor } from "./verify"

const fakeFetch =
  (body: unknown, status = 200) =>
  async () => ({ ok: status < 400, status, json: async () => body })

describe("probeLightningAddress", () => {
  it("reads LNURL-pay metadata and converts msats to sats", async () => {
    const p = await probeLightningAddress(
      "give@grace-fellowship.example",
      fakeFetch({
        tag: "payRequest",
        minSendable: 1000,
        maxSendable: 100_000_000_000,
        metadata: JSON.stringify([["text/plain", "Give to Grace Fellowship"]]),
      }),
    )
    expect(p).toEqual({
      ok: true,
      domain: "grace-fellowship.example",
      minSats: 1n,
      maxSats: 100_000_000n,
      description: "Give to Grace Fellowship",
    })
  })
  it("rejects non-addresses, HTTP errors, LNURL errors and non-pay endpoints", async () => {
    expect(await probeLightningAddress("nope", fakeFetch({}))).toEqual({
      ok: false,
      error: "not a lightning address",
    })
    expect((await probeLightningAddress("a@b.example", fakeFetch({}, 404))).ok).toBe(false)
    expect(
      await probeLightningAddress(
        "a@b.example",
        fakeFetch({ status: "ERROR", reason: "no such user" }),
      ),
    ).toEqual({
      ok: false,
      error: "no such user",
    })
    expect(
      (await probeLightningAddress("a@b.example", fakeFetch({ tag: "withdrawRequest" }))).ok,
    ).toBe(false)
  })
})

describe("verificationFor", () => {
  const ok = { ok: true as const, domain: "grace-fellowship.example", minSats: 1n, maxSats: 1n }
  const at = () => new Date("2026-10-10T00:00:00.000Z")
  it("domain-verifies when the website is on the address domain (or a subdomain)", () => {
    expect(
      verificationFor(
        { lightningAddress: "x", website: "https://grace-fellowship.example/give" },
        ok,
        at,
      ),
    ).toEqual({
      how: "domain",
      at: "2026-10-10T00:00:00.000Z",
    })
    expect(
      verificationFor(
        { lightningAddress: "x", website: "https://www.grace-fellowship.example" },
        ok,
        at,
      )?.how,
    ).toBe("domain")
  })
  it("does not verify a wallet-provider address or an unreachable one", () => {
    expect(
      verificationFor(
        { lightningAddress: "x", website: "https://grace-fellowship.example" },
        { ...ok, domain: "getalby.com" },
        at,
      ),
    ).toBeNull()
    expect(
      verificationFor(
        { lightningAddress: "x", website: "https://grace-fellowship.example" },
        { ok: false, error: "x" },
        at,
      ),
    ).toBeNull()
    expect(verificationFor({ lightningAddress: "x" }, ok, at)).toBeNull()
  })
})
