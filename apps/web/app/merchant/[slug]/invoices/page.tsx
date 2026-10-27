import { InvoiceTools } from "@/components/InvoiceTools"
import { Empty, Panel, PortalShell, Rows, portalHref } from "@/components/merchant/PortalShell"
import { fmtDate, fmtSats, fmtUsd } from "@/lib/merchant/service"
import Link from "next/link"
import { NotFound, loadPortal } from "../_shared"

export const dynamic = "force-dynamic"
export const metadata = { title: "Invoices · Agentic Bitcoin" }

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
    <PortalShell portal={portal} active="invoices" title="Invoices">
      <Panel
        title="Invoices"
        wide
        action={<span className="mp__muted">{portal.invoices.length} total</span>}
      >
        <InvoiceTools slug={portal.slug} token={portal.token} />
      </Panel>
    </PortalShell>
  )
}
