import { LegalLinks, SiteHeader } from "@/components/SiteFrame"
import { cachedStatus } from "@/lib/status/checks"
import type { Metadata } from "next"
import "../page.css"

export const metadata: Metadata = { title: "Status — Agentic Bitcoin" }
export const dynamic = "force-dynamic"

const LABEL = { ok: "operational", degraded: "degraded", down: "down" } as const

export default async function StatusPage() {
  const s = await cachedStatus()
  return (
    <>
      <SiteHeader />
      <main className="page">
        <h1>Status: {LABEL[s.overall]}</h1>
        <p className="small">
          Checked {s.at.replace("T", " ").slice(0, 19)} UTC · refreshes every minute · these are
          reachability probes from our server, not your wallet.
        </p>
        <ul className="status">
          {s.results.map((r) => (
            <li key={r.name} className={`status__row is-${r.state}`}>
              <span className="status__dot" aria-hidden="true" />
              <span className="status__name">{r.name}</span>
              <span className="status__detail">
                {LABEL[r.state]} · {r.detail} · {r.ms} ms
              </span>
            </li>
          ))}
        </ul>
        <p className="small">
          JSON: <a href="/api/status">/api/status</a>
        </p>
      </main>
      <LegalLinks />
    </>
  )
}
