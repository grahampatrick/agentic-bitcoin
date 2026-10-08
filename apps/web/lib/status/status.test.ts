import { describe, expect, it } from "vitest"
import { type CheckDef, overall, runAll, runCheck } from "./checks"

const def: CheckDef = {
  name: "x",
  url: "https://x.test/",
  okStatuses: [200, 401],
  validate: (j) => (j as { ok?: boolean }).ok === true,
}
const resp = (status: number, body = "{}") => new Response(body, { status })

describe("runCheck", () => {
  it("ok on an accepted status with a valid body", async () => {
    const r = await runCheck(
      def,
      (async () => resp(200, '{"ok":true}')) as typeof fetch,
      1000,
      () => 0,
    )
    expect(r).toMatchObject({ state: "ok", detail: "HTTP 200" })
  })
  it("401 counts as reachable when listed; 500 is down", async () => {
    expect((await runCheck(def, (async () => resp(401)) as typeof fetch)).state).toBe("ok")
    expect((await runCheck(def, (async () => resp(500)) as typeof fetch)).state).toBe("down")
  })
  it("degraded on a bad body or a slow answer", async () => {
    expect((await runCheck(def, (async () => resp(200, "{}")) as typeof fetch)).state).toBe(
      "degraded",
    )
    let t = 0
    const slow = (async () => {
      t += 3000
      return resp(200, '{"ok":true}')
    }) as typeof fetch
    expect((await runCheck(def, slow, 5000, () => t)).state).toBe("degraded")
  })
  it("down on network error or timeout", async () => {
    const dead = (async () => {
      throw new Error("ECONNREFUSED")
    }) as typeof fetch
    expect(await runCheck(def, dead)).toMatchObject({ state: "down", detail: "unreachable" })
    const to = (async () => {
      const e = new Error("t")
      e.name = "TimeoutError"
      throw e
    }) as typeof fetch
    expect(await runCheck(def, to)).toMatchObject({ state: "down", detail: "timeout" })
  })
  it("runAll + overall", async () => {
    const results = await runAll((async () => resp(200, '{"ok":true}')) as typeof fetch, [
      def,
      { ...def, name: "y", validate: undefined },
    ])
    expect(results.map((r) => r.state)).toEqual(["ok", "ok"])
    expect(overall(results)).toBe("ok")
    expect(
      overall([
        { name: "a", state: "ok", detail: "", ms: 1 },
        { name: "b", state: "degraded", detail: "", ms: 1 },
      ]),
    ).toBe("degraded")
    expect(overall([{ name: "a", state: "down", detail: "", ms: 1 }])).toBe("down")
  })
})
