import { Empty, Panel, PortalShell, Rows, portalHref } from "@/components/merchant/PortalShell"
import { fmtDate, fmtSats, fmtUsd } from "@/lib/merchant/service"
import Link from "next/link"
import { NotFound, loadPortal } from "../_shared"

export const dynamic = "force-dynamic"
export const metadata = { title: "Event Tickets · Agentic Bitcoin" }

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
    <PortalShell portal={portal} active="tickets" title="Event Tickets">
      <Panel title="Event Tickets" wide>
        <Empty title="Coming soon">
          <p className="mp__muted">
            Sell tickets paid in sats with a QR at the door. Until then, a payment link with the
            event name works the same way.
          </p>
          <Link href={portalHref(portal, "links")} className="mp__btn">
            Create a payment link
          </Link>
        </Empty>
      </Panel>
    </PortalShell>
  )
}
