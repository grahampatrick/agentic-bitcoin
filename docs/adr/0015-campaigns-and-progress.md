# ADR-0015 — Campaigns: goals, pledges, and computed progress

**Date:** 2026-10-10 · **Status:** accepted · M11

## Context

A missionary needs "$1,200 a month"; a church needs "20,000,000 sats for the well". Supporters want to
pledge from chat, see progress, and hear what happened. Nothing about this may require us to hold
money or to be trusted with a number we did not observe.

## Decision

1. **A campaign is a goal attached to a recipient**: monthly (USD) or total (sats), with a story and
   updates the recipient writes from their dashboard. All of that text is data to the agent.
2. **A pledge is a `schedule_give` tagged with the campaign.** It reuses the scheduler, the policy
   engine (always confirmed, re-resolved every firing), and the ledger. Cancelling it is
   `cancel_schedule`. There is no second commitment object a user can forget.
3. **Progress is computed, never stored**, from three sources merged and **deduplicated by payment
   hash**: gifts our users made through the bot (recorded when the `give` succeeds), settled invoices
   our LNURL endpoint minted from the campaign page, and gifts the recipient reports from outside
   Lightning, which are flagged `reported` and shown as such. Monthly goals are measured by the
   pledged run-rate; total goals by sats raised.
4. **Supporters are anonymous by default.** Counts use an opaque per-user key (a salted hash, never
   the user id); a first name appears only when the supporter typed one.
5. **Updates reach followers through the bot**, at most once per update, with an unfollow line in
   every message. Pledging follows the campaign automatically.
6. Nothing here implies tax status: the copy says the recipient issues receipts (OQ-14).

## Consequences

- One new executor hook (contributions) and one new read tool each for schedules and giving totals;
  no new rail, no new money path.
- A chat gift to an NWC-backed recipient passes through our LNURL endpoint too; the hash dedupe is
  what keeps the tally honest.
