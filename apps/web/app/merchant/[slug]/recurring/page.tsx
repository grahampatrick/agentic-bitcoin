import { InvoiceTools } from "@/components/InvoiceTools"
import { Empty, Panel, PortalShell, Rows, portalHref } from "@/components/merchant/PortalShell"
import { fmtDate, fmtSats, fmtUsd } from "@/lib/merchant/service"
import Link from "next/link"
import { NotFound, loadPortal } from "../_shared"

export const dynamic = "force-dynamic"
export const metadata = { title: "Recurring Invoices · Agentic Bitcoin" }

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
    <PortalShell portal={portal} active="recurring" title="Recurring Invoices">
      <Panel title="Recurring Invoices" wide>
        <p className="mp__muted">
          Recurring invoices are created from chat today: tell the assistant “invoice Bob $200 for
          hosting every month” and each one is issued on schedule with its own pay link. The portal
          form below issues single invoices; a schedule picker is coming here.
        </p>
        <InvoiceTools slug={portal.slug} token={portal.token} />
      </Panel>
    </PortalShell>
  )
}
