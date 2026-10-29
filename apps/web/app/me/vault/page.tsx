import { CardToggle } from "@/components/me/MeControls"
import { Empty, MeShell, Row, Section } from "@/components/me/MeShell"
import type { Metadata } from "next"
import Link from "next/link"
import { SignedOut, loadWorkspace, sats } from "../_shared"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Vault · Agentic Bitcoin", robots: { index: false } }

type P = { searchParams: Promise<{ t?: string }> }

export default async function VaultPage({ searchParams }: P) {
  const w = await loadWorkspace(searchParams)
  if (!w) return <SignedOut />
  return (
    <MeShell w={w} active="vault">
      <Section title="Wallet" sub="Your own wallet, reached over Nostr Wallet Connect">
        <Row
          icon="⚡"
          title={w.wallet.connected ? "Connected" : "Not connected"}
          sub={
            w.wallet.connected
              ? "The connection string is sealed; nobody, including us, can read it here. Unpair with /unpair in chat."
              : "Give the assistant a connection with a budget. It spends only within your limits."
          }
          action={
            w.wallet.connected ? null : (
              <Link className="me__btn me__btn--dark" href="/connect">
                Connect
              </Link>
            )
          }
        />
      </Section>

      <Section
        title="Lightning address"
        sub="A name people can pay you at, straight into your wallet"
      >
        {w.address ? (
          <Row
            icon="@"
            title={`${w.address.name}@${w.address.host}`}
            sub={
              w.address.forwardTo
                ? `Forwards to ${w.address.forwardTo}`
                : "Invoices are minted by your own wallet when someone pays this name."
            }
          />
        ) : (
          <Empty>
            No address yet. In chat: <code>/address yourname</code>.
          </Empty>
        )}
      </Section>

      <Section
        title="Cards"
        sub="A card is a monthly budget on your own wallet for one kind of spend"
      >
        {w.cards.length ? (
          w.cards.map((c) => (
            <Row
              key={c.id}
              icon="▭"
              title={
                <>
                  {c.name}
                  {c.state === "paused" ? " · paused" : ""}
                </>
              }
              sub={`${sats(c.spentSats)} of ${sats(c.monthlyCapSats)} this month · pays ${c.scope.join(", ")} · resets ${c.resetsAt.slice(0, 10)}`}
              action={
                <>
                  <Link className="me__btn" href={`/card/${c.id}`}>
                    View
                  </Link>
                  <CardToggle
                    token={w.token}
                    id={c.id}
                    state={c.state === "paused" ? "paused" : "active"}
                  />
                </>
              }
            />
          ))
        ) : (
          <Empty>
            No cards yet. Make one from <Link href="/shop/cards">the store</Link> or say “make me a
            card for Steam, 50,000 sats a month” in chat.
          </Empty>
        )}
      </Section>

      <Section title="Cold storage" sub="The only addresses a sweep may ever go to">
        {w.policy.coldStorageAddresses.length ? (
          w.policy.coldStorageAddresses.map((a) => (
            <Row key={a} icon="❄" title={<code>{a}</code>} sub="Registered in chat with /cold." />
          ))
        ) : (
          <Empty>
            None registered. In chat: <code>/cold bc1q…</code>.
          </Empty>
        )}
      </Section>

      <Section
        title="Keys"
        sub="Sealed with the server's key; the web only knows whether one is set"
      >
        <Row
          icon="◈"
          title="Strike"
          sub={
            w.keys.strike
              ? "Set. Buying, DCA and replace-what-you-spend use it."
              : "Not set. Needed to buy bitcoin. In chat: /key strike <api key>, then delete the message."
          }
        />
        <Row
          icon="◈"
          title="Bitrefill"
          sub={
            w.keys.bitrefill
              ? "Set. Gift cards and top-ups use it."
              : "Not set. The store's gift cards need it. In chat: /key bitrefill <api key>."
          }
        />
      </Section>
    </MeShell>
  )
}
