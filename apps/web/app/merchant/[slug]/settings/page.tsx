import { Empty, Panel, PortalShell, Rows, portalHref } from "@/components/merchant/PortalShell"
import { fmtDate, fmtSats, fmtUsd } from "@/lib/merchant/service"
import Link from "next/link"
import { NotFound, loadPortal } from "../_shared"

export const dynamic = "force-dynamic"
export const metadata = { title: "Settings · Agentic Bitcoin" }

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
    <PortalShell portal={portal} active="settings" title="Settings">
      <Panel title="Profile" wide>
        <Rows
          rows={[
            ["Name", portal.recipient.name],
            ["Kind", portal.recipient.kind],
            ["Slug", <code key="s">{portal.slug}</code>],
            [
              "Website",
              portal.recipient.website ? (
                <a key="w" href={portal.recipient.website}>
                  {portal.recipient.website}
                </a>
              ) : (
                "—"
              ),
            ],
            ["Country", portal.recipient.country ?? "—"],
            ["About", portal.recipient.description ?? "—"],
            [
              "Verified",
              portal.recipient.verifiedDetail
                ? `${portal.recipient.verifiedDetail.how} · ${fmtDate(portal.recipient.verifiedDetail.at)}`
                : "pending",
            ],
          ]}
        />
        <p className="mp__muted">
          Profile edits go through the operator for now; reply to your onboarding message or text
          the assistant.
        </p>
      </Panel>
      <Panel title="Access" wide>
        <p className="mp__muted">
          This portal opens with the token in your link. Anyone with the link can see your orders
          and contacts, so treat it like a password. Lost it? The operator can issue a new one; the
          old link stops working.
        </p>
      </Panel>
    </PortalShell>
  )
}
