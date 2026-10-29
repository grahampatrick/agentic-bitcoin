import { MeShell, Row, Section } from "@/components/me/MeShell"
import type { Metadata } from "next"
import Link from "next/link"
import { SignedOut, loadWorkspace } from "../_shared"

export const dynamic = "force-dynamic"
export const metadata: Metadata = {
  title: "Connectors · Agentic Bitcoin",
  robots: { index: false },
}

type P = { searchParams: Promise<{ t?: string }> }

export default async function ConnectorsPage({ searchParams }: P) {
  const w = await loadWorkspace(searchParams)
  if (!w) return <SignedOut />
  const p = w.policy
  const chat = (cmd: string) => (
    <span className="me__btn" aria-label={`In chat, send ${cmd}`}>
      <code>{cmd}</code> in chat
    </span>
  )
  return (
    <MeShell w={w} active="connectors">
      <Section
        title="Connectors"
        sub="Tools your Anvard can use. Every key stays sealed on the server."
      >
        <Row
          icon="⚡"
          title="Lightning wallet"
          sub={
            w.wallet.connected
              ? "Connected over Nostr Wallet Connect, on the budget you set in the wallet."
              : "Alby Hub, Coinos, Primal, Zeus, LNbits: any wallet that speaks Nostr Wallet Connect."
          }
          action={
            w.wallet.connected ? (
              chat("/unpair")
            ) : (
              <Link className="me__btn me__btn--dark" href="/connect">
                Connect
              </Link>
            )
          }
        />
        <Row
          icon="◈"
          title="Strike"
          sub="Buy bitcoin, DCA on a schedule, replace what you spend. Settles to your Strike account."
          action={w.keys.strike ? chat("/key strike remove") : chat("/key strike")}
        />
        <Row
          icon="▦"
          title="Bitrefill"
          sub="Gift cards and phone top-ups from the store, paid in sats."
          action={w.keys.bitrefill ? chat("/key bitrefill remove") : chat("/key bitrefill")}
        />
        <Row
          icon="▤"
          title="Compute (L402)"
          sub={`Pay-per-call APIs and GPU time. ${p.rails.compute ? "On." : "Off: turn the compute rail on in Preferences."}`}
        />
        <Row
          icon="❄"
          title="Cold storage"
          sub={`${p.coldStorageAddresses.length ? `${p.coldStorageAddresses.length} address${p.coldStorageAddresses.length === 1 ? "" : "es"} registered.` : "No address registered."} Sweeps go nowhere else.`}
          action={chat("/cold")}
        />
        <Row
          icon="▭"
          title="Virtual cards"
          sub={`${w.cards.length} card${w.cards.length === 1 ? "" : "s"}. A budget on your own wallet for one kind of spend.`}
          action={
            <Link className="me__btn" href="/shop/cards">
              New card
            </Link>
          }
        />
        <Row
          icon="✆"
          title={w.identity.surface}
          sub="The chat this workspace belongs to. Discord DMs, when the operator runs that surface, are a second way in."
        />
      </Section>
    </MeShell>
  )
}
