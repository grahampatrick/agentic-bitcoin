import { CopyButton, DestinationList } from "@/components/me/MeControls"
import { Empty, MeShell, Row, Section } from "@/components/me/MeShell"
import type { Metadata } from "next"
import { SignedOut, loadWorkspace } from "../_shared"

export const dynamic = "force-dynamic"
export const metadata: Metadata = {
  title: "Trusted people · Agentic Bitcoin",
  robots: { index: false },
}

type P = { searchParams: Promise<{ t?: string }> }

export default async function PeoplePage({ searchParams }: P) {
  const w = await loadWorkspace(searchParams)
  if (!w) return <SignedOut />
  const allow = w.policy.allowDestinations
  return (
    <MeShell w={w} active="people">
      {w.invites.on ? (
        <Section
          title="Your link"
          sub="Invite someone you trust."
          action={<CopyButton text={w.invites.link} label="Copy link" />}
        />
      ) : null}

      <Section
        title="Trusted destinations"
        sub={
          allow.length
            ? "Only these can receive money from your Anvard."
            : "The list is empty, so anyone you have not blocked can receive. Add one to switch to a short list."
        }
      >
        <DestinationList
          token={w.token}
          kind="allow"
          items={allow}
          placeholder="name@wallet.example or *.example.com"
        />
      </Section>

      <Section title="Blocked" sub="These never receive money, whatever else is allowed.">
        <DestinationList
          token={w.token}
          kind="deny"
          items={w.policy.denyDestinations}
          placeholder="name@scam.example or *.scam.example"
        />
      </Section>

      <Section title="Friends you invited" sub="Who joined with your code, and who has qualified">
        {w.invites.friends.length ? (
          w.invites.friends.map((f) => (
            <Row
              key={`${f.masked}-${f.joinedAt}`}
              icon="☺"
              title={f.masked}
              sub={`Joined ${f.joinedAt.slice(0, 10)} · ${f.qualified ? "qualified: rewards recorded" : "not yet paid"}`}
            />
          ))
        ) : (
          <Empty>No one has joined with your code yet.</Empty>
        )}
      </Section>

      <Section title="Connections" sub="Whether your Anvard moves money at all">
        <Row
          title={w.policy.killSwitch ? "Paused by the kill switch" : "Active"}
          sub={
            w.policy.killSwitch
              ? "Nothing moves, not even reads, until you lift it in Preferences or send /resume."
              : "Payments go through within your limits. /kill in chat stops everything at once."
          }
        />
      </Section>
    </MeShell>
  )
}
