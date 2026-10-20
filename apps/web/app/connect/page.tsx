import { LegalLinks, SiteHeader } from "@/components/SiteFrame"
import type { Metadata } from "next"
import "../page.css"

export const metadata: Metadata = { title: "Connect your wallet · Agentic Bitcoin" }

const BUDGET = 20_000
/** Alby Hub pre-fills a new app connection from these parameters; the user confirms and copies the string. */
const ALBY = `https://my.albyhub.com/apps/new?name=Anvard&max_amount=${BUDGET}&budget_renewal=daily&request_methods=${encodeURIComponent("get_balance make_invoice pay_invoice lookup_invoice get_info")}`

export default function ConnectPage() {
  return (
    <>
      <SiteHeader />
      <main className="page">
        <h1>Connect your wallet.</h1>
        <p>
          Your wallet stays yours. You give the assistant a connection with a daily budget, and it
          spends only within your limits. Thirty seconds, two taps, one paste.
        </p>
        <h2>Alby Hub</h2>
        <ol className="steps">
          <li>
            <a className="cta" href={ALBY} rel="noopener">
              Open Alby Hub with a {BUDGET.toLocaleString("en-US")}-sat daily budget pre-filled
            </a>
          </li>
          <li>Review the budget and expiry, confirm, and copy the connection string.</li>
          <li>
            In Signal, send <code>/pair</code> followed by the string. Then delete that message.
          </li>
        </ol>
        <h2>Coinos</h2>
        <ol className="steps">
          <li>
            No wallet yet?{" "}
            <a href="https://coinos.io" rel="noopener">
              Create a free Coinos account
            </a>
            : it is yours, not ours.
          </li>
          <li>
            In Coinos, open <strong>Settings → Nostr Wallet Connect</strong>, add a connection with
            a budget, copy it.
          </li>
          <li>
            In Signal, send <code>/pair</code> followed by the string. Then delete that message.
          </li>
        </ol>
        <h2>Other wallets</h2>
        <p className="small">
          Any wallet that speaks Nostr Wallet Connect works: Primal, Zeus, Mutiny-style hubs,
          LNbits. Make a connection with a budget and an expiry, then <code>/pair</code> it. The
          assistant refuses connections without a budget.
        </p>
        <p className="small">
          Prefer a Lightning address people can pay you at? Once paired, send{" "}
          <code>/address yourname</code> and you get <code>yourname@anvard.ai</code>, paying
          straight into your wallet.
        </p>
        <LegalLinks />
      </main>
    </>
  )
}
