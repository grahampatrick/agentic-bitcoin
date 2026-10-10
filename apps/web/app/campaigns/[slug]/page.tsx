import { GiveWidget } from "@/components/GiveWidget"
import { LegalLinks, SiteHeader } from "@/components/SiteFrame"
import { campaignView } from "@/lib/campaigns/service"
import { getCampaignStore } from "@/lib/campaigns/store"
import { getPrice } from "@/lib/price/feed"
import { publicView, siteBaseUrl } from "@/lib/receive/service"
import { getReceiveStore } from "@/lib/receive/store"
import type { PriceSnapshot } from "@agentic-bitcoin/core"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import "../../page.css"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const c = await getCampaignStore().get(slug)
  return { title: c ? `${c.title} · Agentic Bitcoin` : "Agentic Bitcoin" }
}

async function priceSnapshot(): Promise<PriceSnapshot | undefined> {
  try {
    const q = await getPrice()
    return { usdCentsPerBtc: BigInt(q.usdCents), asOf: q.asOf, source: q.source }
  } catch {
    return undefined
  }
}

export default async function CampaignPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const receive = getReceiveStore()
  const view = await campaignView(
    { campaigns: getCampaignStore(), receive, price: await priceSnapshot() },
    slug,
  )
  if (!view) notFound()
  const r = await receive.getRecipient(view.campaign.recipientSlug)
  if (!r) notFound()
  const v = publicView(r, siteBaseUrl())
  const p = view.progress
  const monthly = "usdCentsPerMonth" in view.campaign.goal
  return (
    <>
      <SiteHeader />
      <main className="page">
        <h1>{view.campaign.title}.</h1>
        <p className="small">
          for <a href={`/give/${v.slug}`}>{v.name}</a>
          {v.verified ? " · verified" : " · pending verification"}
          {view.campaign.active ? "" : " · closed"}
        </p>
        {view.campaign.story ? <p>{view.campaign.story}</p> : null}
        <div
          className="progress"
          role="img"
          aria-label={p.percent !== null ? `${p.percent}% of goal` : "progress"}
        >
          <div className="progress__bar" style={{ width: `${p.percent ?? 0}%` }} />
        </div>
        <p>
          <strong>{p.raisedSats.toLocaleString("en-US")} sats</strong> raised from {p.supporters}{" "}
          supporter{p.supporters === 1 ? "" : "s"}
          {monthly ? (
            <>
              {" · "}
              <strong>{p.pledgedMonthlySats.toLocaleString("en-US")} sats/month</strong> pledged by{" "}
              {p.pledges}
              {p.percent !== null ? ` · ${p.percent}% of ${p.goalLabel}` : ` · goal ${p.goalLabel}`}
            </>
          ) : (
            <>
              {" · "}
              {p.percent ?? 0}% of {p.goalLabel}
            </>
          )}
        </p>
        {view.supporterNames.length ? (
          <p className="small">
            Thanks to {view.supporterNames.join(", ")} and everyone giving anonymously.
          </p>
        ) : null}
        {view.campaign.active ? (
          <GiveWidget
            slug={v.slug}
            name={v.name}
            mode="give"
            lightningAddress={v.lightningAddress}
            verified={v.verified}
            campaignSlug={view.campaign.slug}
          />
        ) : null}
        <p className="small">
          Monthly support from chat: <code>support {v.slug} $25 a month</code>. Updates in chat:{" "}
          <code>/follow {view.campaign.slug}</code>.
        </p>
        {view.updates.length ? (
          <>
            <h2>Updates</h2>
            <ul className="updates">
              {view.updates.map((u) => (
                <li key={u.id}>
                  <span className="directory__meta">{u.at.slice(0, 10)}</span>
                  <p>{u.text}</p>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <p className="small">
          Every sat goes straight from the giver&rsquo;s wallet to {v.name}&rsquo;s. Agentic Bitcoin
          never holds it and issues no receipts. Amounts marked as reported were entered by the
          recipient.
        </p>
        <LegalLinks />
      </main>
    </>
  )
}
