import { InvoiceTools } from "@/components/InvoiceTools"
import { Empty, Panel, PortalShell, Rows, portalHref } from "@/components/merchant/PortalShell"
import { fmtDate, fmtSats, fmtUsd } from "@/lib/merchant/service"
import Link from "next/link"
import { NotFound, loadPortal } from "../_shared"

export const dynamic = "force-dynamic"
export const metadata = { title: "Payment Links · Agentic Bitcoin" }

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
    <PortalShell portal={portal} active="links" title="Payment Links">
      <Panel
        title="Payment Links"
        wide
        action={<span className="mp__muted">a link anyone can pay from any Lightning wallet</span>}
      >
        <p className="mp__muted">
          A payment link is a one-line request with a pay page. Create one below (choose{" "}
          <em>request</em>), then send the link. Status updates when your wallet sees the payment.
        </p>
        <InvoiceTools slug={portal.slug} token={portal.token} />
      </Panel>
    </PortalShell>
  )
}
