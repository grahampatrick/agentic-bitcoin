import { LegalLinks, SiteHeader } from "@/components/SiteFrame"
import { WaitlistForm } from "@/components/WaitlistForm"
import type { Metadata } from "next"
import "../page.css"

export const metadata: Metadata = { title: "Text Agentic Bitcoin" }

export default function TextPage() {
  return (
    <>
      <SiteHeader />
      <main className="page">
        <h1>Texting opens soon.</h1>
        <p>
          When it does, you will pair your own Lightning wallet with a budget you set, and text the
          assistant like a person. Leave an email or a Nostr npub and we will tell you once.
        </p>
        <WaitlistForm source="text" />
        <p className="small">
          No spam. No tracking. Your contact is stored once, server-side, and deleted on request.
        </p>
      </main>
      <LegalLinks />
    </>
  )
}
