import { CardPanel } from "@/components/CardPanel"
import { LegalLinks, SiteHeader } from "@/components/SiteFrame"
import { cardPage } from "@/lib/cards/service"
import { getCardStore } from "@/lib/cards/store"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import "../../page.css"
import "./card.css"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Virtual card · Agentic Bitcoin",
  robots: { index: false },
}

export default async function CardViewPage({
  params,
  searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string }> }) {
  const { id } = await params
  const { t } = await searchParams
  const v = await cardPage(getCardStore(), id, t)
  if (!v) notFound()
  return (
    <div className="cardpage">
      <div className="cardpage__hero">
        <SiteHeader />
        <CardPanel
          id={v.id}
          name={v.name}
          state={v.state === "paused" ? "paused" : "active"}
          scope={v.scope}
          monthlyCapSats={v.monthlyCapSats.toString()}
          spentSats={v.spentSats.toString()}
          resetsAt={v.resetsAt}
          perActionCapSats={v.perActionCapSats?.toString()}
          confirmAboveSats={v.confirmAboveSats?.toString()}
          canManage={v.canManage}
          token={t}
          unclaimed={v.unclaimed}
        />
      </div>
      <main className="page cardpage__below">
        <p>
          A virtual Lightning card is a monthly budget on your own wallet for one kind of spend.
          Nothing is deposited on it; closing it moves nothing. Payments that match its scope count
          against it, and the assistant asks you above its threshold.
        </p>
        <p className="small">
          In chat: “my cards”, “pause my {v.name.toLowerCase()} card”, “raise my{" "}
          {v.name.toLowerCase()} card to 80,000 sats”. Make another from{" "}
          <a href="/shop/cards">the store</a>.
        </p>
        <LegalLinks />
      </main>
    </div>
  )
}
