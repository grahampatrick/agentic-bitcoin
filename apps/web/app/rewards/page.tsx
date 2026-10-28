import { LegalLinks, SiteHeader } from "@/components/SiteFrame"
import { RewardsLookup } from "@/components/shop/RewardsLookup"
import { formatSats } from "@agentic-bitcoin/core"
import type { Metadata } from "next"
import "../page.css"
import "../shop/shop.css"

export const metadata: Metadata = { title: "Sats-back · Agentic Bitcoin" }
export const dynamic = "force-dynamic"

export default function RewardsPage() {
  const bps = Number(process.env.REWARDS_BPS_DIRECTORY ?? 100)
  const ratePercent = (bps / 100).toFixed(bps % 100 ? 2 : 0) // money-ok: a rate, not money
  const referral = {
    referrerSats: BigInt(process.env.REFERRAL_REWARD_SATS ?? "0"),
    friendSats: BigInt(process.env.REFERRAL_FRIEND_SATS ?? "0"),
    qualifyingSats: BigInt(process.env.REFERRAL_MIN_SPEND_SATS ?? "1000"),
    on: false,
  }
  referral.on = referral.referrerSats > 0n || referral.friendSats > 0n
  return (
    <>
      <SiteHeader />
      <main className="page">
        <h1>Sats-back.</h1>
        <p>
          Buy from the store and get {ratePercent}% back in sats, paid straight to your own wallet.
        </p>
        <h2>How it works</h2>
        <ol className="steps">
          <li>
            When an order is paid, a reward is recorded: a promise from Agentic Bitcoin, funded from
            our own wallet. It is not a balance you hold with us.
          </li>
          <li>
            Digital goods become payable after a day; physical goods after 14 days (the returns
            window). A single purchase earns at most 100,000 sats.
          </li>
          <li>
            Once what is payable reaches 100 sats, we pay it: to an invoice your paired wallet
            creates if you bought by text, or to the Lightning address you gave at checkout on the
            web. You never ask for it and never give us a wallet.
          </li>
          <li>
            Every payout is a Lightning payment with a hash, made under our own daily cap. If our
            wallet cannot pay today, the reward shows as payable and is paid on a later run.
          </li>
        </ol>
        <p className="small">
          Gift cards and top-ups through Bitrefill earn nothing until their programme terms allow
          bitcoin payouts. Rewards are promotional and can be withdrawn for future purchases;
          recorded rewards are honoured. Not tax advice.
        </p>
        <h2>Invite a friend</h2>
        {referral.on ? (
          <p>
            Send <code>/refer</code> in chat for your invite code and link. When a friend joins with
            it and makes a first payment of at least {formatSats(referral.qualifyingSats)},{" "}
            {[
              referral.referrerSats > 0n ? `you get ${formatSats(referral.referrerSats)}` : "",
              referral.friendSats > 0n ? `they get ${formatSats(referral.friendSats)}` : "",
            ]
              .filter(Boolean)
              .join(" and ")}
            , paid to your own wallets the same way. One referral per person, before their first
            payment.
          </p>
        ) : (
          <p>
            Referral rewards are not switched on at the moment. When they are, <code>/refer</code>{" "}
            in chat gives you a code and a link to share.
          </p>
        )}
        <h2>Check an address</h2>
        <RewardsLookup />
        <LegalLinks />
      </main>
    </>
  )
}
