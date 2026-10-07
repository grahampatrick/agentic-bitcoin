import { LegalLinks, SiteHeader } from "@/components/SiteFrame"
import type { Metadata } from "next"
import "../page.css"

export const metadata: Metadata = { title: "Privacy policy — Agentic Bitcoin" }

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <main className="page">
        <h1>Privacy policy</h1>
        <p>
          We collect as little as a product like this can. This page is written in plain words on
          purpose; it is the whole policy.
        </p>
        <h2>What we store</h2>
        <p>
          If you join the list, we store the email address or npub you typed, when you typed it, and
          which page you were on. Nothing else. No cookies, no analytics scripts, no fingerprinting.
        </p>
        <h2>What we never hold</h2>
        <p>
          Your bitcoin, your seed phrase, or your private keys. When the assistant launches, it will
          act through a wallet connection that you issue, with a budget you set, and that you can
          revoke at any time. We do not custody funds.
        </p>
        <h2>Price data</h2>
        <p>
          The price on the home page is fetched by our server from public sources (mempool.space,
          with CoinGecko as a fallback) and cached. Your browser never contacts those services.
        </p>
        <h2>Deletion</h2>
        <p>
          Email us from the address you joined with, or DM from the npub, and we delete the row.
        </p>
        <p className="small">Last updated 2026-10-07.</p>
      </main>
      <LegalLinks />
    </>
  )
}
