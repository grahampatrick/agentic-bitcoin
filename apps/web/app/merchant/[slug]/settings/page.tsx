import { Empty, Panel, PortalShell, Rows, portalHref } from "@/components/merchant/PortalShell"
import { ProfileForm } from "@/components/merchant/ProfileForm"
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
      <Panel
        title="Profile"
        wide
        action={<span className="mp__muted">shown on your pages and in the directory</span>}
      >
        <Rows
          rows={[
            ["Kind", portal.recipient.kind],
            ["Slug", <code key="s">{portal.slug}</code>],
            ["Lightning address", <code key="a">{portal.recipient.lightningAddress}</code>],
            [
              "Verified",
              portal.recipient.verifiedDetail
                ? `${portal.recipient.verifiedDetail.how} · ${fmtDate(portal.recipient.verifiedDetail.at)}`
                : "pending",
            ],
          ]}
        />
        <ProfileForm
          slug={portal.slug}
          token={portal.token}
          name={portal.recipient.name}
          website={portal.recipient.website}
          country={portal.recipient.country}
          description={portal.recipient.description}
        />
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
