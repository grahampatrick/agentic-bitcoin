import { LegalLinks, SiteHeader } from "@/components/SiteFrame"
import { chatLinks } from "@/lib/onboarding-links"
import { formatSats, normalizeCode } from "@agentic-bitcoin/core"
import type { Metadata } from "next"
import "../../page.css"

export const metadata: Metadata = { title: "You're invited · Agentic Bitcoin" }
export const dynamic = "force-dynamic"

/** The referral terms the bot states, read from the same env names (ADR-0025). */
function referralTerms() {
  const referrerSats = BigInt(process.env.REFERRAL_REWARD_SATS ?? "0")
  const friendSats = BigInt(process.env.REFERRAL_FRIEND_SATS ?? "0")
  const qualifyingSats = BigInt(process.env.REFERRAL_MIN_SPEND_SATS ?? "1000")
  return { referrerSats, friendSats, qualifyingSats, on: referrerSats > 0n || friendSats > 0n }
}

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params
  const code = normalizeCode(decodeURIComponent(raw))
  const terms = referralTerms()
  const links = chatLinks()
  const chat = links.signal
    ? { label: `Signal ${links.signal.number}`, url: links.signal.url }
    : links.telegram
      ? { label: `Telegram @${links.telegram.handle}`, url: links.telegram.url }
      : null
  const earn = [
    terms.friendSats > 0n ? `you get ${formatSats(terms.friendSats)}` : "",
    terms.referrerSats > 0n ? `your friend gets ${formatSats(terms.referrerSats)}` : "",
  ]
    .filter(Boolean)
    .join(" and ")
  return (
    <>
      <SiteHeader />
      <main className="page">
        {!code ? (
          <>
            <h1>That is not an invite code.</h1>
            <p>
              An invite code is six letters and digits, like <code>K7PQ2M</code>. Ask your friend to
              send it again, or <a href="/text">start without one</a>.
            </p>
          </>
        ) : (
          <>
            <h1>A friend invited you.</h1>
            <p>
              Your invite code is <code className="invite-code">{code}</code>.
              {terms.on
                ? ` After your first payment of at least ${formatSats(terms.qualifyingSats)}, ${earn}, paid to your own wallets.`
                : " Referral rewards are not switched on at the moment, but the code still gets you in."}
            </p>
            <h2>Three steps</h2>
            <ol className="steps">
              <li>
                {chat ? (
                  <>
                    Text Agentic Bitcoin on <a href={chat.url}>{chat.label}</a>.
                  </>
                ) : (
                  <>
                    <a href="/text">Text Agentic Bitcoin</a>.
                  </>
                )}
              </li>
              <li>
                Send <code>{code}</code> as your very first message (or <code>/join {code}</code>{" "}
                later, any time before your first payment).
              </li>
              <li>
                <a href="/connect">Connect your own wallet</a> with a budget and make a payment.
                Rewards arrive in your wallet automatically; nobody holds a balance for you.
              </li>
            </ol>
            <p className="small">
              A referral links you to one friend, once, before your first payment. Rewards are a
              promise from the operator of this server, paid from their own wallet, and can be
              withdrawn for future referrals; recorded rewards are honoured. Not financial advice.
            </p>
          </>
        )}
        <LegalLinks />
      </main>
    </>
  )
}
