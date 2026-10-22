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
    <>
      <SiteHeader />
      <main className="page">
        <h1>Your card.</h1>
        <p>
          A virtual Lightning card is a monthly budget on your own wallet for one kind of spend.
          Nothing is deposited on it; closing it moves nothing. Payments that match its scope count
          against it, and the assistant asks you above its threshold.
        </p>
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
        />
        <p className="small">
          In chat: “my cards”, “pause my {v.name.toLowerCase()} card”, “raise my{" "}
          {v.name.toLowerCase()} card to 80,000 sats”. A physical tap-to-pay version of this card is
          planned.
        </p>
        <LegalLinks />
      </main>
    </>
  )
}
