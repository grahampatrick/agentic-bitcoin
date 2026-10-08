import { describe, expect, it } from "vitest"
import { CronError, matches, nextRun, parseCron } from "./cron"

const at = (iso: string) => new Date(iso)

describe("parseCron", () => {
  it("parses stars, lists, ranges, steps and names", () => {
    const s = parseCron("0 14 * * 5")
    expect([...s.minute]).toEqual([0])
    expect([...s.hour]).toEqual([14])
    expect(s.dom.size).toBe(31)
    expect([...s.dow]).toEqual([5])
    expect([...parseCron("*/15 9-17 1,15 jan-mar mon-fri").minute]).toEqual([0, 15, 30, 45])
    expect([...parseCron("*/15 9-17 1,15 jan-mar mon-fri").month]).toEqual([1, 2, 3])
    expect([...parseCron("0 0 * * sun").dow]).toEqual([0])
    expect([...parseCron("0 0 * * 7").dow]).toEqual([0]) // 7 == Sunday
    expect([...parseCron("5/10 * * * *").minute]).toEqual([5, 15, 25, 35, 45, 55])
  })
  it.each([
    "",
    "* * * *",
    "60 * * * *",
    "* 24 * * *",
    "* * 0 * *",
    "* * * 13 *",
    "a * * * *",
    "*/0 * * * *",
    "10-5 * * * *",
  ])("rejects %j", (e) => {
    expect(() => parseCron(e)).toThrow(CronError)
  })
})

describe("matches / nextRun", () => {
  it("Fridays at 14:00 UTC", () => {
    const s = parseCron("0 14 * * 5")
    expect(matches(s, at("2026-10-09T14:00:30.000Z"))).toBe(true) // a Friday
    expect(matches(s, at("2026-10-09T14:01:00.000Z"))).toBe(false)
    expect(matches(s, at("2026-10-08T14:00:00.000Z"))).toBe(false) // Thursday
    expect(nextRun(s, at("2026-10-07T12:00:00.000Z"))?.toISOString()).toBe(
      "2026-10-09T14:00:00.000Z",
    )
    expect(nextRun(s, at("2026-10-09T14:00:00.000Z"))?.toISOString()).toBe(
      "2026-10-16T14:00:00.000Z",
    ) // strictly after
  })
  it("every minute and the 1st-and-15th pattern", () => {
    expect(nextRun(parseCron("* * * * *"), at("2026-10-07T12:00:40.000Z"))?.toISOString()).toBe(
      "2026-10-07T12:01:00.000Z",
    )
    expect(nextRun(parseCron("0 9 1,15 * *"), at("2026-10-07T12:00:00.000Z"))?.toISOString()).toBe(
      "2026-10-15T09:00:00.000Z",
    )
  })
  it("returns null when nothing matches inside the horizon", () => {
    expect(nextRun(parseCron("0 0 31 2 *"), at("2026-10-07T12:00:00.000Z"))).toBeNull()
  })
})
