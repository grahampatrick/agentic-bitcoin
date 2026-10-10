import { GiveWidget } from "@/components/GiveWidget"
import { LegalLinks, SiteHeader } from "@/components/SiteFrame"
import { publicView, siteBaseUrl } from "@/lib/receive/service"
import { getReceiveStore } from "@/lib/receive/store"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import "../../page.css"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const r = await getReceiveStore().getRecipient(slug)
  return { title: r ? `Tip ${r.name} · Agentic Bitcoin` : "Agentic Bitcoin" }
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const r = await getReceiveStore().getRecipient(slug)
  if (!r) notFound()
  const v = publicView(r, siteBaseUrl())
  return (
    <>
      <SiteHeader />
      <main className="page">
        <h1>Tip {v.name}.</h1>
        {v.description ? <p>{v.description}</p> : null}
        <p className="small">
          {v.kind}
          {v.country ? ` · ${v.country}` : ""}
          {v.verified ? " · verified" : " · pending verification"}
          {v.website ? (
            <>
              {" · "}
              <a href={v.website} rel="noopener nofollow">
                {v.website.replace(/^https?:\/\//, "")}
              </a>
            </>
          ) : null}
        </p>
        <GiveWidget
          slug={v.slug}
          name={v.name}
          mode="tip"
          lightningAddress={v.lightningAddress}
          verified={v.verified}
        />
        <p className="small">
          A tip goes straight from your wallet to theirs. Agentic Bitcoin never holds it.
        </p>
        <LegalLinks />
      </main>
    </>
  )
}
