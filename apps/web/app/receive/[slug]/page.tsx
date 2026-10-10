import { CampaignTools } from "@/components/CampaignTools"
import { LegalLinks, SiteHeader } from "@/components/SiteFrame"
import { getCampaignStore } from "@/lib/campaigns/store"
import { dashboardFor, siteBaseUrl, tipSnippet } from "@/lib/receive/service"
import { getReceiveStore } from "@/lib/receive/store"
import type { Metadata } from "next"
import "../../page.css"

export const metadata: Metadata = { title: "Your gifts · Agentic Bitcoin" }
export const dynamic = "force-dynamic"

export default async function Dashboard({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ t?: string }>
}) {
  const { slug } = await params
  const { t } = await searchParams
  const base = siteBaseUrl()
  const dash = await dashboardFor({ store: getReceiveStore(), baseUrl: base }, slug, t ?? "")
  const campaigns = dash
    ? (await getCampaignStore().listForRecipient(dash.recipient.slug)).map((c) => ({
        slug: c.slug,
        title: c.title,
        active: c.active,
        goalLabel:
          "satsTotal" in c.goal
            ? `${c.goal.satsTotal.toLocaleString("en-US")} sats`
            : `$${(c.goal.usdCentsPerMonth / 100n).toString()}/month`, // money-ok: label
      }))
    : []
  return (
    <>
      <SiteHeader />
      <main className="page">
        {!dash ? (
          <>
            <h1>Not found.</h1>
            <p className="small">
              This dashboard link is wrong or expired. If you lost yours, contact the operator.
            </p>
          </>
        ) : (
          <>
            <h1>{dash.recipient.name}.</h1>
            <p className="small">
              <code>{dash.recipient.lightningAddress}</code> ·{" "}
              {dash.recipient.verified
                ? "verified and listed"
                : "pending verification (pages work; not listed yet)"}
            </p>
            <p>
              Settled:{" "}
              <strong>{Math.floor(dash.settledMsats / 1000).toLocaleString("en-US")} sats</strong>
              {dash.canSeeSettlement
                ? ""
                : " (settlement is only visible for connected wallets; your wallet app is the record)"}
            </p>
            <h2>Invoices we created for you</h2>
            <ol className="demo__ledger">
              {dash.invoices.length === 0 ? (
                <li className="demo__empty">
                  None yet. Share {base}/give/{dash.recipient.slug}.
                </li>
              ) : null}
              {dash.invoices.map((i) => (
                <li key={i.paymentHash} className={i.settledAt ? "is-succeeded" : "is-pending"}>
                  <span className="demo__outcome">{i.settledAt ? "settled" : "unpaid"}</span>
                  <span className="demo__summary">
                    {Math.floor(i.amountMsats / 1000).toLocaleString("en-US")} sats ·{" "}
                    {i.createdAt.slice(0, 16).replace("T", " ")}
                  </span>
                  {i.comment ? <span className="demo__detail">“{i.comment}”</span> : null}
                </li>
              ))}
            </ol>
            <CampaignTools slug={dash.recipient.slug} token={t ?? ""} campaigns={campaigns} />
            <h2>Your tip button</h2>
            <pre className="receive__snippet">
              {tipSnippet(base, dash.recipient.slug, dash.recipient.name)}
            </pre>
            <p className="small">
              Pages: <a href={`/give/${dash.recipient.slug}`}>/give/{dash.recipient.slug}</a> ·{" "}
              <a href={`/tip/${dash.recipient.slug}`}>/tip/{dash.recipient.slug}</a>
            </p>
          </>
        )}
        <LegalLinks />
      </main>
    </>
  )
}
