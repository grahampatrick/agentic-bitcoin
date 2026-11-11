/**
 * M25 — the bot's half of the desk (ADR-0029): every settings change, planned then committed.
 *
 * `planSetting` validates a change against the stores and returns either the reason it cannot be
 * made or a `commit` that makes it and says what happened. Three callers share it, so there is
 * one implementation of each change:
 *
 * - the agent's `change_setting` tool (check → the human's yes when it widens → commit),
 * - the old slash commands, kept as aliases (plan → commit at once: the human typed it),
 * - nothing else. The model never reaches a store except through here.
 */
import type { UserContext } from "@agentic-bitcoin/agent"
import {
  type CampaignStore,
  DEFAULT_POLICY,
  type LightningAddressStore,
  type Policy,
  type PolicyStore,
  RAIL_LABEL,
  type RecipientStore,
  type ReferralRules,
  type ReferralStore,
  SLUG_RE,
  type SecretStore,
  type SettingChange,
  type WebLinkStore,
  applyPolicySetting,
  describeLimits,
  formatCents,
  formatSats,
  hasSpent,
  isLightningAddress,
  joinWithCode,
  normalizeAddressName,
  normalizeCode,
  parseAddress,
  parseSettingSats,
  patchPolicy,
  readEntries,
  referralsEnabled,
  replaceSetting,
  slugify,
} from "@agentic-bitcoin/core"

export type Plan = { ok: false; error: string } | { ok: true; commit(): Promise<string> }
const no = (error: string): Plan => ({ ok: false, error })
const yes = (commit: () => Promise<string>): Plan => ({ ok: true, commit })

export interface DeskDeps {
  policies: PolicyStore
  secrets: SecretStore
  recipients?: RecipientStore
  probeAddress?(address: string): Promise<{ ok: true } | { ok: false; error: string }>
  campaigns?: CampaignStore
  addresses?: LightningAddressStore
  referrals?: { store: ReferralStore; rules: ReferralRules; newId: () => string }
  webLinks?: { store: WebLinkStore }
  siteUrl?: string
  onCredentialsChanged?(userId: string): void
  resolveContext(userId: string): Promise<UserContext>
  now: () => Date
}

export async function planSetting(deps: DeskDeps, userId: string, c: SettingChange): Promise<Plan> {
  const policy = (await deps.policies.get(userId)) ?? DEFAULT_POLICY
  const save = (p: Policy) => deps.policies.set(userId, p)
  const value = c.value.trim()
  const host = deps.siteUrl ? new URL(deps.siteUrl).host : "anvard.ai"

  switch (c.setting) {
    case "daily_cap":
    case "per_action_cap":
    case "confirm_above":
    case "allow_destination":
    case "deny_destination":
    case "rail":
    case "kill_switch": {
      const r = applyPolicySetting(policy, c)
      if (!r) return no("That setting is not available.")
      if (!r.ok) return no(r.error)
      return yes(async () => {
        await save(r.policy)
        return r.text
      })
    }

    case "replace": {
      const hasExchange = !!(await deps.resolveContext(userId)).rails.exchange
      const r = applyReplaceArgs(policy, [c.op, value].filter(Boolean), deps.now(), hasExchange)
      if (!r.ok) return no(r.error)
      return yes(async () => {
        if (r.policy !== policy) await save(r.policy)
        return r.text
      })
    }

    case "cold_storage": {
      if (!value) return no("Which bitcoin address?")
      if (c.op === "remove") {
        if (!policy.coldStorageAddresses.includes(value.toLowerCase()))
          return no("That address is not one of your cold-storage addresses.")
        return yes(async () => {
          await save({
            ...policy,
            coldStorageAddresses: policy.coldStorageAddresses.filter(
              (d) => d !== value.toLowerCase(),
            ),
          })
          return "Removed. Sweeps can no longer go to that address."
        })
      }
      let parsed: Awaited<ReturnType<typeof parseAddress>>
      try {
        parsed = await parseAddress(value)
      } catch (err) {
        return no(`That is not a valid bitcoin address (${(err as Error).message}).`)
      }
      return yes(async () => {
        await save({
          ...policy,
          coldStorageAddresses: [...new Set([...policy.coldStorageAddresses, value.toLowerCase()])],
        })
        return `Registered ${parsed.kind} address on ${parsed.network}: ${value.slice(0, 10)}…${value.slice(-6)}.${policy.rails.onchain ? "" : " Cold-storage sweeps are switched off; say “turn on cold-storage sweeps” when you want them."}\nEvery sweep still asks you to confirm.`
      })
    }

    case "recipient": {
      const store = deps.recipients
      if (!store) return no("Giving is not enabled on this server.")
      if (c.op === "remove") {
        const r = value ? await store.get(value.toLowerCase(), userId) : null
        if (!r || r.ownerUserId !== userId)
          return no("You can only remove recipients you added. Ask me who you can give to.")
        return yes(async () => {
          await store.remove(r.slug)
          return `Removed ${r.name}. Any recurring gift to it will pause at its next run.`
        })
      }
      const address = value.toLowerCase()
      const name = c.name.trim().slice(0, 80)
      if (!isLightningAddress(address))
        return no(`${address || "That"} is not a Lightning address (name@domain).`)
      const slug = slugify(name)
      if (!SLUG_RE.test(slug))
        return no("Give the recipient a name with at least two letters or digits.")
      const existing = await store.get(slug, userId)
      if (existing && existing.ownerUserId !== userId)
        return no(`“${slug}” is already a directory recipient. Pick a different name.`)
      if (deps.probeAddress) {
        const p = await deps.probeAddress(address)
        if (!p.ok)
          return no(
            `That address does not answer Lightning payments right now (${p.error}). Not saved.`,
          )
      }
      return yes(async () => {
        await store.upsert({
          slug,
          kind: "creator",
          name,
          lightningAddress: address,
          verified: null,
          ownerUserId: userId,
        })
        return `Saved ${name} as ${slug} (private to you). Say “give 1000 sats to ${slug}” or “give 5000 sats to ${slug} every month”.`
      })
    }

    case "campaign_updates": {
      const store = deps.campaigns
      if (!store) return no("Campaigns are not enabled on this server.")
      const camp = value ? await store.get(value.toLowerCase()) : null
      if (!camp) return no("Which campaign? Ask me what campaigns there are.")
      return yes(async () => {
        if (c.op === "follow") {
          await store.follow(camp.slug, userId)
          return `Following ${camp.title}: I will send you its updates here. Say “unfollow ${camp.slug}” to stop.`
        }
        await store.unfollow(camp.slug, userId)
        return `No more updates from ${camp.title}.`
      })
    }

    case "lightning_address": {
      const store = deps.addresses
      if (!store) return no("Lightning addresses are not enabled on this server.")
      const current = await store.getForUser(userId)
      if (c.op === "remove") {
        if (!current) return no("You have no address.")
        return yes(async () => {
          await store.remove(current.name)
          return `Removed ${current.name}@${host}.`
        })
      }
      if (c.op === "forward") {
        const to = value.toLowerCase()
        if (!isLightningAddress(to))
          return no("Forwarding needs a Lightning address you already have (name@domain).")
        if (!current) return no("Claim a name first: tell me the name you want.")
        if (deps.probeAddress) {
          const p = await deps.probeAddress(to)
          if (!p.ok) return no(`${to} does not answer Lightning payments (${p.error}).`)
        }
        return yes(async () => {
          await store.update({ ...current, forwardTo: to, nwcSealed: undefined })
          return `${current.name}@${host} now forwards to ${to}.`
        })
      }
      const name = normalizeAddressName(value)
      if (!name)
        return no(
          "Names are 2–32 characters: letters, digits, dot, dash, underscore. Some names are reserved.",
        )
      if (current)
        return no(
          `You already have ${current.name}@${host}. Give that one up first if you want ${name}.`,
        )
      if (await store.get(name)) return no(`${name}@${host} is taken.`)
      const blob = await deps.secrets.get(userId, "nwc")
      if (!blob) return no("Connect your wallet first: your address pays straight into it.")
      return yes(async () => {
        await store.create({ name, userId, nwcSealed: blob, createdAt: deps.now().toISOString() })
        return `${name}@${host} is yours. Anyone can pay it from any Lightning wallet; each invoice is created by your own wallet and the sats land there. I will tell you when something arrives. Keep your wallet reachable (Alby Hub on, or Coinos).`
      })
    }

    case "wallet": {
      if (!(await deps.secrets.get(userId, "nwc"))) return no("No wallet is connected.")
      return yes(async () => {
        await deps.secrets.delete(userId, "nwc")
        deps.onCredentialsChanged?.(userId)
        return "Wallet disconnected. Also revoke the connection in your wallet app."
      })
    }

    case "key": {
      const name = value.toLowerCase()
      if (name !== "strike" && name !== "bitrefill") return no("Which key? strike or bitrefill.")
      if (!(await deps.secrets.get(userId, name))) return no(`No ${name} key is stored.`)
      return yes(async () => {
        await deps.secrets.delete(userId, name)
        deps.onCredentialsChanged?.(userId)
        return `${name} key removed. Also revoke it on their site.`
      })
    }

    case "referral_code": {
      const rc = deps.referrals
      if (!rc || !referralsEnabled(rc.rules))
        return no("Referral rewards are not on for this server.")
      const code = normalizeCode(value)
      if (!code) return no("An invite code is six characters. Check it with your friend.")
      const why = (k: string) =>
        ({
          UNKNOWN_CODE: `No invite with the code ${code}. Check it with your friend.`,
          SELF: "That is your own invite code.",
          ALREADY_REFERRED:
            "You already joined with a friend's code; a referral cannot be changed.",
          ALREADY_SPENT:
            "A friend's code counts only before your first payment, and you have already paid.",
        })[k] ?? "Referral rewards are not on for this server."
      const referrer = await rc.store.userForCode(code)
      if (!referrer) return no(why("UNKNOWN_CODE"))
      if (referrer === userId) return no(why("SELF"))
      if (await rc.store.forFriend(userId)) return no(why("ALREADY_REFERRED"))
      const spent = async () =>
        hasSpent(await readEntries((await deps.resolveContext(userId)).ledger))
      if (await spent()) return no(why("ALREADY_SPENT"))
      return yes(async () => {
        const r = await joinWithCode(rc.store, rc.rules, {
          code,
          friendId: userId,
          spent: await spent(),
          now: deps.now(),
          newId: rc.newId,
        })
        if (!r.ok) throw new Error(why(r.code))
        return `You're in with ${code}: ${joinTerms(rc.rules)}`
      })
    }

    case "workspace_links": {
      const wl = deps.webLinks
      if (!wl || !deps.siteUrl) return no("The web workspace is not on for this server.")
      return yes(async () => {
        await wl.store.revokeAll(userId)
        return "Every web link for you is revoked. Ask me for a new one any time."
      })
    }
  }
}

export function joinTerms(rules: ReferralRules): string {
  const you = rules.friendSats > 0n ? `you get ${formatSats(rules.friendSats)}` : ""
  const them = rules.referrerSats > 0n ? `your friend gets ${formatSats(rules.referrerSats)}` : ""
  return `after your first payment of at least ${formatSats(rules.qualifyingSats)}, ${[you, them].filter(Boolean).join(" and ")}, paid to your own wallets.`
}

/** `/budget daily 50000` and friends, as the change they ask for. Null when the words do not parse. */
export function budgetChange(args: string[]): SettingChange | null {
  const [key, a, b] = args.map((x) => x.trim())
  const c = (setting: SettingChange["setting"], op: string, value = ""): SettingChange => ({
    setting,
    op,
    value,
    name: "",
  })
  switch (key?.toLowerCase()) {
    case "daily":
      return a ? c("daily_cap", "set", a) : null
    case "action":
      return a ? c("per_action_cap", "set", a) : null
    case "confirm":
      return a ? c("confirm_above", "set", a) : null
    case "allow":
      return a ? c("allow_destination", "add", a) : null
    case "unallow":
      return a ? c("allow_destination", "remove", a) : null
    case "deny":
      return a ? c("deny_destination", "add", a) : null
    case "undeny":
      return a ? c("deny_destination", "remove", a) : null
    case "rail": {
      const on = b?.toLowerCase()
      return a && (on === "on" || on === "off") ? c("rail", on, a) : null
    }
    default:
      return null
  }
}

export function describePolicy(p: Policy): string {
  return [
    ...describeLimits(p),
    p.replaceSpend?.enabled ? `Replace what you spend: ${describeReplace(p.replaceSpend)}` : "",
    "To change one, tell me: “set my daily cap to 50,000 sats”, “ask me above 5,000”, “block *.evil.example”, “turn on buying bitcoin”.",
  ]
    .filter(Boolean)
    .join("\n")
}

export function describeReplace(r: NonNullable<Policy["replaceSpend"]>): string {
  return `${r.percent}% of every spend bought back on ${r.exchange}${r.toWallet ? " and swept into your wallet" : ""} · spends under ${formatCents(r.minUsdCents)} skipped · at most ${formatCents(r.dailyCapUsdCents)} a day`
}

/**
 * Replace-what-you-spend as words: `on [percent]` · `off` · `cap <dollars>` · `min <dollars>` ·
 * `wallet on|off` · nothing to show it. Pure. Turning it on needs an exchange key; it also switches
 * buying bitcoin on, because that is what the person just asked for.
 */
export function applyReplaceArgs(
  p: Policy,
  args: string[],
  now: Date,
  hasExchange: boolean,
): { ok: true; policy: Policy; text: string } | { ok: false; error: string } {
  const [key, ...rest] = args
  const cur = p.replaceSpend
  const usage =
    "Tell me one of: replace what I spend · replace half of what I spend · stop replacing · replace at most $20 a day · skip replacing under $1."
  const show = (r: NonNullable<Policy["replaceSpend"]>) =>
    r.enabled
      ? `Replace is ON: ${describeReplace(r)}.\nSay “stop replacing” to turn it off.`
      : "Replace is off. Say “replace the bitcoin I spend” and I buy back what you spend on your own Strike account; “replace half of what I spend” buys back half."
  if (!key) return { ok: true, policy: p, text: show(cur ?? replaceSetting({}, now)) }
  const dollars = (v: string | undefined): bigint | null => {
    const m = /^\$?(\d{1,6})(?:\.(\d{1,2}))?$/.exec(v ?? "")
    if (!m) return null
    return BigInt(m[1] ?? "0") * 100n + BigInt((m[2] ?? "").padEnd(2, "0"))
  }
  switch (key.toLowerCase()) {
    case "on": {
      const pct = rest[0] ? Number(rest[0].replace(/%$/, "")) : (cur?.percent ?? 100)
      if (!Number.isInteger(pct) || pct < 1 || pct > 100)
        return { ok: false, error: "Percent is a whole number from 1 to 100." }
      if (!hasExchange)
        return {
          ok: false,
          error:
            "Replace buys on your own exchange account. Add a Strike key first: say “connect Strike”.",
        }
      const r = replaceSetting(
        { ...cur, enabled: true, percent: pct, since: now.toISOString() },
        now,
      )
      const policy: Policy = { ...p, replaceSpend: r, rails: { ...p.rails, exchange: true } }
      return {
        ok: true,
        policy,
        text: `Replace is ON from now: ${describeReplace(r)}. Each buy-back goes through your limits and shows in your activity.${p.rails.exchange ? "" : " Buying bitcoin is now switched on."}`,
      }
    }
    case "off": {
      if (!cur?.enabled) return { ok: true, policy: p, text: "Replace is already off." }
      return {
        ok: true,
        policy: { ...p, replaceSpend: { ...cur, enabled: false } },
        text: "Replace is off. Nothing already bought changes.",
      }
    }
    case "cap": {
      const c = dollars(rest[0])
      if (c === null || c < 100n)
        return { ok: false, error: "The cap is dollars a day, at least $1." }
      const r = replaceSetting({ ...cur, dailyCapUsdCents: c }, now)
      return { ok: true, policy: { ...p, replaceSpend: r }, text: show(r) }
    }
    case "min": {
      const c = dollars(rest[0])
      if (c === null) return { ok: false, error: "The minimum is a dollar amount, e.g. 1." }
      const r = replaceSetting({ ...cur, minUsdCents: c }, now)
      return { ok: true, policy: { ...p, replaceSpend: r }, text: show(r) }
    }
    case "wallet": {
      const v = rest[0]?.toLowerCase()
      if (v !== "on" && v !== "off") return { ok: false, error: usage }
      const r = replaceSetting({ ...cur, toWallet: v === "on" }, now)
      return { ok: true, policy: { ...p, replaceSpend: r }, text: show(r) }
    }
    default:
      return { ok: false, error: usage }
  }
}
