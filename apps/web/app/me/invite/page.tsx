import { CopyButton, ShareButton } from "@/components/me/MeControls"
import { MeShell, Row, Section } from "@/components/me/MeShell"
import type { Metadata } from "next"
import { SignedOut, loadWorkspace, sats } from "../_shared"

export const dynamic = "force-dynamic"
export const metadata: Metadata = {
  title: "Invite a friend · Agentic Bitcoin",
  robots: { index: false },
}

type P = { searchParams: Promise<{ t?: string }> }

export default async function InvitePage({ searchParams }: P) {
  const w = await loadWorkspace(searchParams)
  if (!w) return <SignedOut />
  const inv = w.invites
  return (
    <MeShell w={w} active="invite">
      <Section title="Invite a friend">
        {inv.on ? (
          <>
            <p className="me__note" style={{ fontSize: "inherit", color: "inherit" }}>
              Share a link to invite someone to Anvard. The same link works for every friend.
            </p>
            <p className="me__note">
              {inv.usedThisMonth} of {inv.maxPerMonth} rewarded invites used this month. An invite
              counts when your friend's first payment of at least {sats(inv.qualifyingSats)} goes
              through.
            </p>
            <div className="me__linkbox">
              <code>{inv.link}</code>
              <CopyButton text={inv.link} />
            </div>
            <Row
              title={`${inv.joined} joined · ${inv.qualified} qualified · ${sats(inv.earnedSats)} earned`}
              sub={`You get ${sats(inv.referrerSats)} per friend who qualifies and they get ${sats(inv.friendSats)}, paid to your own wallets by the next payout run.`}
            />
            <p className="me__label">Your code</p>
            <div className="me__linkbox">
              <code className="me__code">{inv.code}</code>
              <CopyButton text={inv.code} />
            </div>
            <p className="me__note">
              A friend can also just text the code as their first message; it links you two and
              opens the door when the server asks for an invite.
            </p>
            <ShareButton
              url={inv.link}
              text={`Join me on Anvard with code ${inv.code}`}
              label="Invite a friend to Anvard"
            />
            <p className="me__note">
              Rewards are a promise from this server's operator, paid from their own wallet; nobody
              holds a balance for you. One referral per person, before their first payment.
            </p>
          </>
        ) : (
          <Row
            title="Referral rewards are not switched on for this server"
            sub="When they are, your link, code and tally appear here, and /refer in chat says the same."
          />
        )}
      </Section>
    </MeShell>
  )
}
