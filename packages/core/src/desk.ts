/**
 * M25 — the desk (ADR-0029): what the slash commands used to do, as two ordinary actions.
 *
 * - `show` reads one of the user's views (activity, limits, orders…). It moves nothing.
 * - `change_setting` proposes one change to the user's own settings. A change that only stops or
 *   narrows (kill switch on, a rail off, a lower cap, a blocked destination) applies at once; a
 *   change that widens what may move, where it may go, or touches a credential or an identity
 *   waits for the human's yes. The yes comes from the person, never from the model.
 *
 * This file is the pure half: the vocabulary, the one-line summary a human confirms, and the
 * narrow/widen rule. The stores live behind the `Desk` hook the executor is given.
 */
import { formatSats } from "./money"
import type { Policy } from "./policy"
import { patchPolicy } from "./workspace"

export const DESK_VIEWS = [
  "activity",
  "limits",
  "connections",
  "orders",
  "notes",
  "giving_statement",
  "invoices_csv",
  "lightning_address",
  "campaigns",
  "replace",
  "workspace_link",
  "shop",
  "receive",
  "connect_wallet",
  "connect_strike",
  "connect_bitrefill",
] as const
export type DeskView = (typeof DESK_VIEWS)[number]

export const DESK_SETTINGS = [
  "daily_cap",
  "per_action_cap",
  "confirm_above",
  "allow_destination",
  "deny_destination",
  "rail",
  "kill_switch",
  "replace",
  "cold_storage",
  "recipient",
  "campaign_updates",
  "lightning_address",
  "wallet",
  "key",
  "referral_code",
  "workspace_links",
] as const
export type DeskSetting = (typeof DESK_SETTINGS)[number]

/**
 * One change. `op`, `value` and `name` mean, per setting:
 *
 * | setting            | op                          | value                         | name          |
 * |--------------------|-----------------------------|-------------------------------|---------------|
 * | daily_cap          | set                         | sats                          |               |
 * | per_action_cap     | set                         | sats                          |               |
 * | confirm_above      | set                         | sats (0 = always ask)         |               |
 * | allow_destination  | add · remove                | address or pattern            |               |
 * | deny_destination   | add · remove                | address or pattern            |               |
 * | rail               | on · off                    | wallet/exchange/goods/…       |               |
 * | kill_switch        | on · off                    |                               |               |
 * | replace            | on · off · cap · min · wallet | percent · dollars · on/off  |               |
 * | cold_storage       | add · remove                | bitcoin address               |               |
 * | recipient          | add · remove                | Lightning address · slug      | display name  |
 * | campaign_updates   | follow · unfollow           | campaign slug                 |               |
 * | lightning_address  | claim · remove · forward    | name · — · Lightning address  |               |
 * | wallet             | disconnect                  |                               |               |
 * | key                | remove                      | strike · bitrefill            |               |
 * | referral_code      | join                        | the friend's code             |               |
 * | workspace_links    | revoke                      |                               |               |
 */
export interface SettingChange {
  setting: DeskSetting
  op: string
  value: string
  name: string
}

export const SETTING_OPS: Record<DeskSetting, readonly string[]> = {
  daily_cap: ["set"],
  per_action_cap: ["set"],
  confirm_above: ["set"],
  allow_destination: ["add", "remove"],
  deny_destination: ["add", "remove"],
  rail: ["on", "off"],
  kill_switch: ["on", "off"],
  replace: ["on", "off", "cap", "min", "wallet"],
  cold_storage: ["add", "remove"],
  recipient: ["add", "remove"],
  campaign_updates: ["follow", "unfollow"],
  lightning_address: ["claim", "remove", "forward"],
  wallet: ["disconnect"],
  key: ["remove"],
  referral_code: ["join"],
  workspace_links: ["revoke"],
}

/** What a person calls each switch ("rail" is our word, not theirs). */
export const RAIL_LABEL: Record<keyof Policy["rails"], string> = {
  wallet: "Wallet payments",
  exchange: "Buying bitcoin",
  goods: "Shopping",
  compute: "Paid APIs",
  onchain: "Cold-storage sweeps",
}

/** The same words mid-sentence ("turn on paid APIs"). */
export function railWords(rail: keyof Policy["rails"]): string {
  const l = RAIL_LABEL[rail]
  return rail === "compute" ? "paid APIs" : l.toLowerCase()
}

/** What the executor needs from whoever owns the stores (the bot). */
export interface Desk {
  /**
   * The text of a view. `direct` is text that must reach the human as-is and must never pass
   * through the model: a bearer link, a CSV.
   */
  show(view: DeskView, arg: string): Promise<{ text: string; direct?: string }>
  /** Why a change cannot be made, or null when it can. Called before the human is asked for a yes. */
  check(change: SettingChange): Promise<string | null>
  /** Make the change and say what happened. Throws with a message a person can read. */
  change(change: SettingChange): Promise<{ text: string }>
}

const SATS_RE = /^\d{1,13}$/

/** "50,000" / "50000 sats" / "50_000" → 50000n; null when it is not a whole number of sats. */
export function parseSettingSats(v: string): bigint | null {
  const t = v
    .trim()
    .toLowerCase()
    .replace(/\s*sats?$/, "")
    .replace(/[,_\s]/g, "")
  return SATS_RE.test(t) ? BigInt(t) : null
}

function short(addr: string): string {
  return addr.length > 20 ? `${addr.slice(0, 10)}…${addr.slice(-6)}` : addr
}

/** One line a human reads before saying yes. With the policy in hand, caps show what they replace. */
export function describeSetting(c: SettingChange, policy?: Policy): string {
  const v = c.value.trim()
  const sats = parseSettingSats(v)
  const amount = sats === null ? v : formatSats(sats)
  const from = (now: bigint | undefined) => (now === undefined ? "" : ` (now ${formatSats(now)})`)
  switch (c.setting) {
    case "daily_cap":
      return `Set your daily cap to ${amount}${from(policy?.dailyCapSats)}`
    case "per_action_cap":
      return `Set your per-payment cap to ${amount}${from(policy?.perActionCapSats)}`
    case "confirm_above":
      return sats === 0n
        ? `Ask you before every payment${from(policy?.confirmAboveSats)}`
        : `Ask you before payments of ${amount} or more${from(policy?.confirmAboveSats)}`
    case "allow_destination":
      return c.op === "remove"
        ? `Remove ${v} from the destinations you allow`
        : `Add ${v} to the destinations you allow (once the list has entries, only they can be paid)`
    case "deny_destination":
      return c.op === "remove" ? `Unblock ${v}` : `Block ${v} from ever being paid`
    case "rail":
      return `Turn ${v} ${c.op === "on" ? "on" : "off"}`
    case "kill_switch":
      return c.op === "on" ? "Stop everything (kill switch on)" : "Lift the kill switch"
    case "replace":
      switch (c.op) {
        case "on":
          return `Buy back ${v ? `${v.replace(/%$/, "")}%` : "all"} of what you spend, on your own exchange account`
        case "off":
          return "Stop buying back what you spend"
        case "cap":
          return `Buy back at most $${v.replace(/^\$/, "")} a day`
        case "min":
          return `Skip buy-backs for spends under $${v.replace(/^\$/, "")}`
        default:
          return `Sweep buy-backs into your wallet: ${v || "on"}`
      }
    case "cold_storage":
      return c.op === "remove"
        ? `Remove the cold-storage address ${short(v)}`
        : `Register the cold-storage address ${short(v)} (sweeps may only go to registered addresses)`
    case "recipient":
      return c.op === "remove"
        ? `Remove your recipient ${v}`
        : `Save “${c.name.trim() || v}” <${v}> as a recipient only you can give to`
    case "campaign_updates":
      return c.op === "unfollow" ? `Stop updates from ${v}` : `Send you updates from ${v}`
    case "lightning_address":
      return c.op === "remove"
        ? "Give up your Lightning address"
        : c.op === "forward"
          ? `Forward your Lightning address to ${v}`
          : `Claim the Lightning address “${v}”, paid into your own wallet`
    case "wallet":
      return "Disconnect your wallet"
    case "key":
      return `Remove your ${v} key`
    case "referral_code":
      return `Join with the invite code ${v.toUpperCase()} (this cannot be changed later)`
    case "workspace_links":
      return "Revoke every web link to your workspace"
  }
}

/**
 * True when the change can only stop or narrow what may move, so it applies without a yes
 * (the same line ADR-0021 draws for cards: pausing is instant, widening is confirmed).
 * Anything not provably narrower is treated as widening.
 */
export function settingNarrows(c: SettingChange, policy: Policy): boolean {
  const sats = parseSettingSats(c.value)
  switch (c.setting) {
    case "daily_cap":
      return sats !== null && sats > 0n && sats <= policy.dailyCapSats
    case "per_action_cap":
      return sats !== null && sats > 0n && sats <= policy.perActionCapSats
    case "confirm_above":
      // a lower threshold asks more often
      return sats !== null && sats <= policy.confirmAboveSats
    case "deny_destination":
      return c.op === "add"
    case "rail":
      return c.op === "off"
    case "kill_switch":
      return c.op === "on"
    case "replace":
      return c.op === "off"
    case "cold_storage":
    case "recipient":
      return c.op === "remove"
    case "campaign_updates":
      // updates are messages, not money
      return c.op === "follow" || c.op === "unfollow"
    case "workspace_links":
      return c.op === "revoke"
    case "allow_destination": // adding widens a non-empty list; removing the last entry opens it to everyone
    case "lightning_address": // where incoming money lands
    case "wallet":
    case "key":
    case "referral_code":
      return false
  }
}

/**
 * The settings that live in the policy alone (caps, the two lists, switches, the kill switch),
 * applied purely: the new policy and a sentence, or why not. Null for a setting that needs a
 * store. The bot's desk and the demo sandbox both stand on this.
 */
export function applyPolicySetting(
  policy: Policy,
  c: SettingChange,
): { ok: true; policy: Policy; text: string } | { ok: false; error: string } | null {
  const value = c.value.trim()
  switch (c.setting) {
    case "daily_cap":
    case "per_action_cap":
    case "confirm_above": {
      const n = parseSettingSats(value)
      if (n === null) return { ok: false, error: "That needs a whole number of sats, e.g. 20000." }
      // a daily cap below the per-payment cap brings the per-payment cap down with it
      const lowered = c.setting === "daily_cap" && n > 0n && n < policy.perActionCapSats
      const r = patchPolicy(
        policy,
        c.setting === "daily_cap"
          ? { dailyCapSats: n, ...(lowered ? { perActionCapSats: n } : {}) }
          : c.setting === "per_action_cap"
            ? { perActionCapSats: n }
            : { confirmAboveSats: n },
      )
      if (!r.ok) return { ok: false, error: `${r.error}.` }
      const text =
        c.setting === "daily_cap"
          ? `Your daily cap is now ${formatSats(n)}${lowered ? `, and the per-payment cap came down with it to ${formatSats(n)}` : ""}.`
          : c.setting === "per_action_cap"
            ? `Your per-payment cap is now ${formatSats(n)}.`
            : n === 0n
              ? "I will ask you before every payment."
              : `I will ask you before any payment of ${formatSats(n)} or more.`
      return { ok: true, policy: r.policy, text }
    }
    case "allow_destination":
    case "deny_destination": {
      const allow = c.setting === "allow_destination"
      const list = allow ? policy.allowDestinations : policy.denyDestinations
      const d = value.toLowerCase()
      if (!d)
        return { ok: false, error: "Which destination? A Lightning address, *@domain or *.host." }
      if (c.op === "remove") {
        if (!list.includes(d))
          return { ok: false, error: `${d} is not on your ${allow ? "allow" : "block"} list.` }
        const r = patchPolicy(policy, allow ? { allowRemove: d } : { denyRemove: d })
        if (!r.ok) return { ok: false, error: `${r.error}.` }
        const text = !allow
          ? `Unblocked ${d}.`
          : r.policy.allowDestinations.length
            ? `Removed ${d}. You now pay only: ${r.policy.allowDestinations.join(", ")}.`
            : `Removed ${d}. Your allow list is empty, so anyone you have not blocked can be paid.`
        return { ok: true, policy: r.policy, text }
      }
      const r = patchPolicy(policy, allow ? { allowAdd: d } : { denyAdd: d })
      if (!r.ok) return { ok: false, error: `${r.error}.` }
      return {
        ok: true,
        policy: r.policy,
        text: allow
          ? `Added ${d}. You now pay only: ${r.policy.allowDestinations.join(", ")}.`
          : `Blocked ${d}. It will never be paid.`,
      }
    }
    case "rail": {
      const rail = value.toLowerCase() as keyof Policy["rails"]
      if (!(rail in policy.rails))
        return { ok: false, error: "Which one? wallet, exchange, goods, compute or onchain." }
      const on = c.op === "on"
      return {
        ok: true,
        policy: { ...policy, rails: { ...policy.rails, [rail]: on } },
        text: `${RAIL_LABEL[rail]} is now ${on ? "on" : "off"}.`,
      }
    }
    case "kill_switch": {
      const on = c.op === "on"
      return {
        ok: true,
        policy: { ...policy, killSwitch: on },
        text: on
          ? "Stopped. Nothing moves until you say “resume”."
          : "The kill switch is off. Your limits still apply.",
      }
    }
    default:
      return null
  }
}

/** The user's limits in a few lines, with no command in sight. */
export function describeLimits(p: Policy): string[] {
  const on = (Object.keys(p.rails) as (keyof Policy["rails"])[])
    .filter((k) => p.rails[k])
    .map((k) => railWords(k))
    .join(", ")
  return [
    `Daily cap ${formatSats(p.dailyCapSats)} · per payment ${formatSats(p.perActionCapSats)} · I ask you at ${formatSats(p.confirmAboveSats)} or more`,
    `Switched on: ${on || "nothing"}${p.killSwitch ? " · KILL SWITCH ON (say “resume” to lift it)" : ""}`,
    p.allowDestinations.length
      ? `You pay only: ${p.allowDestinations.join(", ")}`
      : "You can pay anyone you have not blocked",
    p.denyDestinations.length ? `Blocked: ${p.denyDestinations.join(", ")}` : "",
    p.coldStorageAddresses.length ? `Cold storage: ${p.coldStorageAddresses.join(", ")}` : "",
  ].filter(Boolean)
}
