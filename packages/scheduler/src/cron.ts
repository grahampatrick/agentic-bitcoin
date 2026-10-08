/**
 * Five-field cron (minute hour day-of-month month day-of-week), UTC. Supports `*`, lists, ranges,
 * steps (`*​/5`, `1-10/2`) and names for months/days. No dependency; ~60 lines; fully tested.
 */
export class CronError extends Error {
  readonly code = "CRON"
  constructor(message: string) {
    super(message)
    this.name = "CronError"
  }
}

type Field = Set<number>
export interface CronSpec {
  minute: Field
  hour: Field
  dom: Field
  month: Field
  dow: Field
  source: string
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]

export function parseCron(expr: string): CronSpec {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) throw new CronError(`expected 5 fields, got ${parts.length}: "${expr}"`)
  const [m, h, dom, mon, dow] = parts as [string, string, string, string, string]
  return {
    minute: field(m, 0, 59),
    hour: field(h, 0, 23),
    dom: field(dom, 1, 31),
    month: field(mon, 1, 12, MONTHS, 1),
    dow: field(dow, 0, 7, DAYS, 0),
    source: expr.trim(),
  }
}

function field(spec: string, min: number, max: number, names: string[] = [], nameBase = 0): Field {
  const out = new Set<number>()
  for (const part of spec.toLowerCase().split(",")) {
    const [rangePart, stepPart] = part.split("/")
    const step = stepPart === undefined ? 1 : Number(stepPart)
    if (!Number.isInteger(step) || step < 1) throw new CronError(`bad step in "${part}"`)
    let lo: number
    let hi: number
    if (rangePart === "*" || rangePart === "") {
      lo = min
      hi = max
    } else {
      const [a, b] = (rangePart ?? "").split("-")
      lo = value(a ?? "", names, nameBase)
      hi = b === undefined ? (stepPart === undefined ? lo : max) : value(b, names, nameBase)
    }
    if (lo < min || hi > max || lo > hi) throw new CronError(`"${part}" out of range ${min}-${max}`)
    for (let v = lo; v <= hi; v += step) out.add(v === 7 && max === 7 ? 0 : v) // dow 7 == Sunday
  }
  return out
}

function value(token: string, names: string[], base: number): number {
  const idx = names.indexOf(token)
  if (idx !== -1) return idx + base
  if (!/^\d+$/.test(token)) throw new CronError(`bad value "${token}"`)
  return Number(token)
}

/** Does this UTC minute match? */
export function matches(spec: CronSpec, at: Date): boolean {
  return (
    spec.minute.has(at.getUTCMinutes()) &&
    spec.hour.has(at.getUTCHours()) &&
    spec.month.has(at.getUTCMonth() + 1) &&
    spec.dom.has(at.getUTCDate()) &&
    spec.dow.has(at.getUTCDay())
  )
}

/** Next matching minute strictly after `from`, within `horizonDays` (default 366), else null. */
export function nextRun(spec: CronSpec, from: Date, horizonDays = 366): Date | null {
  const t = new Date(from)
  t.setUTCSeconds(0, 0)
  t.setUTCMinutes(t.getUTCMinutes() + 1)
  const end = from.getTime() + horizonDays * 86_400_000
  while (t.getTime() <= end) {
    if (matches(spec, t)) return new Date(t)
    t.setUTCMinutes(t.getUTCMinutes() + 1)
  }
  return null
}
