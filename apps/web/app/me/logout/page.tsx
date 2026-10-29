import { LogoutButton } from "@/components/me/MeControls"
import { MeShell, Row, Section } from "@/components/me/MeShell"
import type { Metadata } from "next"
import { SignedOut, loadWorkspace } from "../_shared"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Log out · Agentic Bitcoin", robots: { index: false } }

type P = { searchParams: Promise<{ t?: string }> }

export default async function LogoutPage({ searchParams }: P) {
  const w = await loadWorkspace(searchParams)
  if (!w) return <SignedOut />
  return (
    <MeShell w={w} active="logout">
      <Section title="Log out" sub="Links are the only way in, so logging out means revoking them">
        <Row
          title="This browser"
          sub="Revokes the link you opened this page with. Other links keep working."
          action={<LogoutButton token={w.token} label="Log out" />}
        />
        <Row
          title="Everywhere"
          sub={`Revokes all ${w.links} of your links. /web in chat makes a new one whenever you want.`}
          action={<LogoutButton token={w.token} all label="Log out everywhere" />}
        />
      </Section>
    </MeShell>
  )
}
