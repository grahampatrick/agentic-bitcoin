import { ReceiveForm } from "@/components/ReceiveForm"
import { LegalLinks, SiteHeader } from "@/components/SiteFrame"
import { siteBaseUrl } from "@/lib/receive/service"
import type { Metadata } from "next"
import "../page.css"

export const metadata: Metadata = { title: "Receive · Agentic Bitcoin" }
export const dynamic = "force-dynamic"

export default function ReceivePage() {
  return (
    <>
      <SiteHeader />
      <main className="page">
        <h1>Receive.</h1>
        <p>
          A church, a missionary, a creator: get a Lightning address, a give page and a tip button
          in a minute. Every payment lands in <em>your</em> wallet; we never hold it. Bring a
          Lightning address you already have, or connect your own wallet with a receive-only
          connection.
        </p>
        <ReceiveForm baseUrl={siteBaseUrl()} />
        <p className="small">
          We list you in the directory once we have confirmed the address with you. Until then your
          pages and address already work for anyone you send them to.
        </p>
        <LegalLinks />
      </main>
    </>
  )
}
