import { LegalLinks, SiteHeader } from "@/components/SiteFrame"
import { WaitlistForm } from "@/components/WaitlistForm"
import { chatLinks } from "@/lib/onboarding-links"
import type { Metadata } from "next"
import QRCode from "qrcode"
import "../page.css"

export const metadata: Metadata = { title: "Text Agentic Bitcoin" }
export const dynamic = "force-dynamic"

export default async function TextPage() {
  const links = chatLinks()
  const primary = links.signal?.url ?? links.telegram?.url
  if (!primary) return <Waitlist />
  const qrSvg = await QRCode.toString(primary, {
    type: "svg",
    margin: 1,
    width: 192,
    color: { dark: "#1f2322", light: "#ffffff" },
  })
  const qrDataUrl = `data:image/svg+xml;base64,${Buffer.from(qrSvg).toString("base64")}`
  return (
    <>
      <SiteHeader />
      <main className="page">
        <h1>Text Agentic Bitcoin.</h1>
        {links.signal ? (
          <p>
            On Signal: <a href={links.signal.url}>{links.signal.number}</a>
            {links.telegram ? (
              <>
                {" "}
                · or on Telegram: <a href={links.telegram.url}>@{links.telegram.handle}</a>
              </>
            ) : null}
          </p>
        ) : (
          <p>
            On Telegram: <a href={links.telegram?.url}>@{links.telegram?.handle}</a>
          </p>
        )}
        <img
          className="qr"
          src={qrDataUrl}
          alt="QR code to open the chat"
          width={192}
          height={192}
        />
        <h2>Five minutes to your first action</h2>
        <ol className="steps">
          <li>
            Send <code>/start</code>. I ask three questions: daily cap, when to ask you first, and
            which things I may do.
          </li>
          <li>
            In your own wallet (Alby Hub, Coinos, Primal, Zeus), create a Nostr Wallet Connect
            connection <strong>with a budget and an expiry</strong>. Send it as{" "}
            <code>/pair &lt;string&gt;</code>. I refuse strings without a budget.
          </li>
          <li>
            Ask: “what's my balance?” then “pay 21 sats to someone@getalby.com”. Over your threshold
            I show a summary and wait for your yes.
          </li>
          <li>
            Optional: <code>/key strike</code> to buy bitcoin on your Strike account,{" "}
            <code>/key bitrefill</code> for gift cards and top-ups. Keys are encrypted and shown
            masked.
          </li>
        </ol>
        <p className="small">
          Non-custodial: your wallet enforces the budget you set, and so do I. <code>/kill</code>{" "}
          stops everything. Not financial advice.
        </p>
      </main>
      <LegalLinks />
    </>
  )
}

function Waitlist() {
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
