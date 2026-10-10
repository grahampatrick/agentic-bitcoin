import { LegalLinks, SiteHeader } from "@/components/SiteFrame"
import { getCampaignStore } from "@/lib/campaigns/store"
import { type DirectoryEntry, KIND_LABEL, loadDirectory } from "@/lib/recipients"
import type { Metadata } from "next"
import "../page.css"

export const metadata: Metadata = { title: "Give · Agentic Bitcoin" }
export const dynamic = "force-dynamic"

export default async function GivePage() {
  const entries = await loadDirectory()
  const campaigns = await getCampaignStore()
    .listActive()
    .catch(() => [])
  const groups = new Map<DirectoryEntry["kind"], DirectoryEntry[]>()
  for (const e of entries ?? []) groups.set(e.kind, [...(groups.get(e.kind) ?? []), e])
  return (
    <>
      <SiteHeader />
      <main className="page">
        <h1>Give.</h1>
        <p>
          A tithe to your church, monthly support for a missionary, a tip to someone whose work you
          value — sent directly from your wallet to theirs. We never hold the money. Every recipient
          here is verified: either their Lightning address lives on their own domain, or we vouched
          for them personally.
        </p>
        <p>
          In chat, say <code>which churches can I give to?</code>, then{" "}
          <code>give 10000 sats to grace-fellowship</code> or{" "}
          <code>tithe 20000 sats to grace-fellowship every sunday</code>. Anyone you know can be
          added privately with <code>/recipient add &lt;lightning address&gt; &lt;name&gt;</code>.
        </p>
        {campaigns.length ? (
          <section>
            <h2>Campaigns</h2>
            <ul className="directory">
              {campaigns.map((c) => (
                <li key={c.slug}>
                  <a href={`/campaigns/${c.slug}`}>
                    <strong>{c.title}</strong>
                  </a>{" "}
                  <span className="directory__meta">for {c.recipientSlug}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {entries === null || entries.length === 0 ? (
          <p className="small">
            The public directory opens with the first verified churches and missionaries. Until
            then, add your own recipients in chat; they stay private to you.
          </p>
        ) : (
          [...groups.entries()].map(([kind, list]) => (
            <section key={kind}>
              <h2>{KIND_LABEL[kind]}</h2>
              <ul className="directory">
                {list.map((e) => (
                  <li key={e.slug}>
                    <strong>{e.name}</strong> <code>{e.slug}</code>
                    {e.country ? <span className="directory__meta"> · {e.country}</span> : null}
                    <span className="directory__meta">
                      {" "}
                      · verified by {e.verifiedHow === "domain" ? "their domain" : "us"}
                    </span>
                    {e.description ? <p>{e.description}</p> : null}
                    {e.website ? (
                      <a href={e.website} rel="noopener nofollow">
                        {e.website.replace(/^https?:\/\//, "")}
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
        <p>
          Are you a church, missionary or creator?{" "}
          <a href="/receive">Receive through your own wallet</a>: a Lightning address, a give page
          and a tip button, in a minute.
        </p>
        <p className="small">
          We are not the recipient of any gift and issue no receipts; ask your church or missionary
          for one. Your own record is one message away: <code>/statement</code>.
        </p>
        <LegalLinks />
      </main>
    </>
  )
}
