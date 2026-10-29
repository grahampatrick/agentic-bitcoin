import { LimitsForm, LogoutButton, Toggle } from "@/components/me/MeControls"
import { MeShell, Row, Section } from "@/components/me/MeShell"
import type { Metadata } from "next"
import { SignedOut, loadWorkspace } from "../_shared"

export const dynamic = "force-dynamic"
export const metadata: Metadata = {
  title: "Preferences · Agentic Bitcoin",
  robots: { index: false },
}

type P = { searchParams: Promise<{ t?: string }> }

const RAILS: {
  key: "wallet" | "exchange" | "goods" | "compute" | "onchain"
  label: string
  sub: string
}[] = [
  { key: "wallet", label: "Wallet", sub: "Send and receive over Lightning from your own wallet" },
  {
    key: "exchange",
    label: "Buying",
    sub: "Buy bitcoin, DCA and replace what you spend, through your Strike key",
  },
  { key: "goods", label: "Store", sub: "Orders from the store and gift cards" },
  { key: "compute", label: "Compute", sub: "Pay for API calls and GPU time by the second (L402)" },
  {
    key: "onchain",
    label: "On-chain",
    sub: "Sweeps to your registered cold-storage addresses only",
  },
]

export default async function PreferencesPage({ searchParams }: P) {
  const w = await loadWorkspace(searchParams)
  if (!w) return <SignedOut />
  const p = w.policy
  return (
    <MeShell w={w} active="preferences">
      <Section title="Sign-in" sub="The chat you text from is your identity; there is no password">
        <Row icon="✆" title={w.identity.surface} sub={w.identity.masked} />
        <Row
          icon="⌘"
          title="Web links"
          sub={`${w.links} active. Each works for thirty days; /web in chat makes another.`}
          action={<LogoutButton token={w.token} all label="Log out everywhere" />}
        />
      </Section>

      <Section title="Limits" sub="Caps the assistant can never exceed, whatever you ask it">
        <LimitsForm
          token={w.token}
          dailyCapSats={p.dailyCapSats.toString()}
          perActionCapSats={p.perActionCapSats.toString()}
          confirmAboveSats={p.confirmAboveSats.toString()}
        />
      </Section>

      <Section title="Rails" sub="What kinds of thing your Anvard may do">
        {RAILS.map((r) => (
          <Row
            key={r.key}
            title={r.label}
            sub={r.sub}
            action={
              <Toggle
                token={w.token}
                on={p.rails[r.key]}
                body={{ op: "rail", rail: r.key }}
                onLabel="On"
                offLabel="Off"
              />
            }
          />
        ))}
      </Section>

      <Section title="Kill switch" sub="One switch that stops everything">
        <Row
          title={p.killSwitch ? "ON: nothing moves" : "Off: running within your limits"}
          sub="The same as /kill and /resume in chat."
          action={
            <Toggle
              token={w.token}
              on={p.killSwitch}
              body={{ op: "kill" }}
              onLabel="Lift it"
              offLabel="Stop everything"
            />
          }
        />
      </Section>

      <Section
        title="Replace what you spend"
        sub="Buy back the bitcoin you pay out, as a standing rule"
      >
        <Row
          title={p.replaceSpend?.enabled ? "On" : "Off"}
          sub={
            p.replaceSpend?.enabled
              ? "Set in chat with /replace; change it there."
              : "In chat: /replace on, /replace 50%, /replace cap $20."
          }
        />
      </Section>
    </MeShell>
  )
}
