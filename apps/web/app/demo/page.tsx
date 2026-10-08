import { LegalLinks, SiteHeader } from "@/components/SiteFrame"
import { DemoChat } from "@/components/demo/DemoChat"
import type { Metadata } from "next"
import "../page.css"
import "./demo.css"

export const metadata: Metadata = {
  title: "Try Agentic Bitcoin",
  description:
    "A sandbox with fake sats and the real rules: text the assistant, watch the ledger and the limits react.",
}

export default function DemoPage() {
  return (
    <>
      <SiteHeader />
      <main className="page page--wide">
        <h1>Try it. Fake sats, real rules.</h1>
        <p>
          This is the assistant running against a sandbox wallet. Everything you ask goes through
          the same policy engine, executor and ledger as production; only the money is pretend. Over
          your threshold it stops and asks. Over a cap it refuses and says why.
        </p>
        <DemoChat />
      </main>
      <LegalLinks />
    </>
  )
}
