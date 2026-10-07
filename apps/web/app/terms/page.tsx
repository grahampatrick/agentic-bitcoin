import { LegalLinks, SiteHeader } from "@/components/SiteFrame"
import type { Metadata } from "next"
import "../page.css"

export const metadata: Metadata = { title: "Terms of service — Agentic Bitcoin" }

export default function TermsPage() {
  return (
    <>
      <SiteHeader />
      <main className="page">
        <h1>Terms of service</h1>
        <p>
          Agentic Bitcoin is open-source software, published under the MIT licence, and this site is
          a description of it plus a waiting list. Using the site means you agree to the following.
        </p>
        <h2>Not financial advice</h2>
        <p>
          Nothing here recommends buying, selling, or holding bitcoin, or when to do so. The
          assistant executes instructions you give it. It does not give advice, and neither do we.
        </p>
        <h2>Non-custodial, as is</h2>
        <p>
          We never hold your funds or keys. Software that moves money can fail; the assistant runs
          with the budget and limits you set, and you are responsible for setting them. The software
          is provided as is, without warranty, as the MIT licence says.
        </p>
        <h2>The price</h2>
        <p>
          The price shown is informational, from third-party sources, and may be delayed or wrong.
        </p>
        <h2>Changes</h2>
        <p>
          These terms change when the product does. The date below is the version you agreed to.
        </p>
        <p className="small">Last updated 2026-10-07.</p>
      </main>
      <LegalLinks />
    </>
  )
}
