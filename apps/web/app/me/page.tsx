import { CopyButton, ShareButton } from "@/components/me/MeControls"
import { MeShell, Row, Section, meHref } from "@/components/me/MeShell"
import type { Metadata } from "next"
import Link from "next/link"
import { SignedOut, loadWorkspace, sats } from "./_shared"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Workspace · Agentic Bitcoin", robots: { index: false } }

type P = { searchParams: Promise<{ t?: string }> }

export default async function WorkspacePage({ searchParams }: P) {
  const w = await loadWorkspace(searchParams)
  if (!w) return <SignedOut />
  const inv = w.invites
  const left = Math.max(0, inv.maxPerMonth - inv.usedThisMonth)
  return (
    <MeShell w={w} active="">
      <Section title="Invites" sub="Give friends their own Anvard">
        {inv.on ? (
          <>
            <div className="me__meter">
              <p className="me__meter-big">
                {inv.usedThisMonth}
                <span>/{inv.maxPerMonth}</span>
              </p>
              <p className="me__meter-label">rewarded this month · {left} left</p>
            </div>
            <div className="me__bars" aria-hidden="true">
              {Array.from({ length: inv.maxPerMonth }, (_, i) => (
                <span
                  key={`bar-${i.toString()}`}
                  className={i < inv.usedThisMonth ? "is-used" : ""}
                />
              ))}
            </div>
            <p className="me__label">Your invite link</p>
            <div className="me__linkbox">
              <code>{inv.link.replace(/^https?:\/\//, "")}</code>
              <CopyButton text={inv.link} />
            </div>
            <ShareButton
              url={inv.link}
              text={`Join me on Anvard with code ${inv.code}`}
              label="Invite a friend to Anvard"
            />
            <p className="me__note">
              A friend joins by texting the code <span className="me__code">{inv.code}</span> first,
              or <code>/join {inv.code}</code> before their first payment. Their first payment of at
              least {sats(inv.qualifyingSats)} earns you {sats(inv.referrerSats)} and them{" "}
              {sats(inv.friendSats)}, paid to your own wallets.{" "}
              <Link href={meHref(w.token, "invite")}>More</Link>
            </p>
          </>
        ) : (
          <Row
            title="Referral rewards are not switched on for this server"
            sub="When they are, your invite link and tally appear here."
          />
        )}
      </Section>

      <Section title="At a glance" sub="What your Anvard is allowed to do right now">
        <Row
          title={w.policy.killSwitch ? "Kill switch is ON" : "Running"}
          sub={
            w.policy.killSwitch
              ? "Nothing moves until you lift it."
              : `Daily cap ${sats(w.policy.dailyCapSats.toString())} · per action ${sats(w.policy.perActionCapSats.toString())} · asks you above ${sats(w.policy.confirmAboveSats.toString())}`
          }
          action={
            <Link className="me__btn" href={meHref(w.token, "preferences")}>
              Limits
            </Link>
          }
        />
        <Row
          title={w.wallet.connected ? "Wallet connected" : "No wallet connected"}
          sub={
            w.wallet.connected
              ? "Your own wallet, on a budget you set. We never hold a sat."
              : "Pair your own wallet to start paying."
          }
          action={
            <Link
              className="me__btn"
              href={w.wallet.connected ? meHref(w.token, "vault") : "/connect"}
            >
              {w.wallet.connected ? "Vault" : "Connect"}
            </Link>
          }
        />
        <Row
          title="Rewards"
          sub={`${sats(w.rewards.payableSats)} payable · ${sats(w.rewards.pendingSats)} pending · ${sats(w.rewards.paidSats)} paid so far`}
          action={
            <Link className="me__btn" href="/rewards">
              How it works
            </Link>
          }
        />
      </Section>

      <Section title="Contact" sub="Ways to reach Anvard directly">
        {w.contact.signal ? (
          <Row
            icon="✆"
            title="Signal"
            sub={w.contact.signal.number}
            action={
              <>
                <CopyButton text={w.contact.signal.number} />
                <a className="me__btn" href={w.contact.signal.url}>
                  Open
                </a>
              </>
            }
          />
        ) : null}
        {w.contact.discord ? (
          <Row
            icon="◎"
            title="Discord"
            sub="Direct messages only; payments never happen in a channel"
            action={
              <a className="me__btn" href={w.contact.discord} rel="noopener">
                Open
              </a>
            }
          />
        ) : null}
        {w.contact.email ? (
          <Row
            icon="@"
            title="Email"
            sub={w.contact.email}
            action={
              <>
                <CopyButton text={w.contact.email} />
                <a className="me__btn" href={`mailto:${w.contact.email}`}>
                  Write
                </a>
              </>
            }
          />
        ) : null}
        {!w.contact.signal && !w.contact.discord && !w.contact.email ? (
          <Row
            title="No contact channels are set on this server"
            sub="The operator sets NEXT_PUBLIC_SIGNAL_NUMBER, NEXT_PUBLIC_DISCORD_INVITE or NEXT_PUBLIC_CONTACT_EMAIL."
          />
        ) : null}
      </Section>
    </MeShell>
  )
}
