import { CampaignTools } from "@/components/CampaignTools"
import { Empty, Panel, PortalShell, Rows, portalHref } from "@/components/merchant/PortalShell"
import { fmtDate, fmtSats, fmtUsd } from "@/lib/merchant/service"
import { tipSnippet } from "@/lib/receive/service"
import Link from "next/link"
import { NotFound, loadPortal } from "../_shared"

export const dynamic = "force-dynamic"
export const metadata = { title: "Payment Requests · Agentic Bitcoin" }

type P = { params: Promise<{ slug: string }>; searchParams: Promise<{ t?: string }> }

export default async function Page({ params, searchParams }: P) {
  const portal = await loadPortal(params, searchParams)
  if (!portal) return <NotFound />
  void fmtDate
  void fmtSats
  void fmtUsd
  void portalHref
  void Link
  void Rows
  void Empty
  return (
    <PortalShell portal={portal} active="requests" title="Payment Requests">
      <Panel title="Your pages" wide>
        <Rows
          rows={[
            [
              "Give page",
              <a key="g" href={`/give/${portal.slug}`}>
                {portal.base}/give/{portal.slug}
              </a>,
            ],
            [
              "Tip page",
              <a key="t" href={`/tip/${portal.slug}`}>
                {portal.base}/tip/{portal.slug}
              </a>,
            ],
            ["Lightning address", <code key="a">{portal.recipient.lightningAddress}</code>],
          ]}
        />
      </Panel>
      <Panel title="Tip button" wide>
        <p className="mp__muted">Paste this on your site. It opens your tip page in a new tab.</p>
        <pre className="receive__snippet">
          {tipSnippet(portal.base, portal.slug, portal.recipient.name)}
        </pre>
      </Panel>
      <Panel title="Campaigns" wide>
        <CampaignTools slug={portal.slug} token={portal.token} campaigns={portal.campaigns} />
      </Panel>
    </PortalShell>
  )
}
