import { Empty, Panel, PortalShell, Rows, portalHref } from "@/components/merchant/PortalShell"
import { fmtDate, fmtSats, fmtUsd } from "@/lib/merchant/service"
import Link from "next/link"
import { NotFound, loadPortal } from "../_shared"

export const dynamic = "force-dynamic"
export const metadata = { title: "Transactions · Agentic Bitcoin" }

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
    <PortalShell portal={portal} active="transactions" title="Transactions">
      <Panel
        title="Transactions"
        wide
        action={<span className="mp__muted">tips, gifts, orders and invoices</span>}
      >
        {portal.received.length || portal.invoices.length || portal.orders.length ? (
          <table className="mp__table">
            <thead>
              <tr>
                <th>When</th>
                <th>Kind</th>
                <th>Amount</th>
                <th>Detail</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {[
                ...portal.received.map((i) => ({
                  at: i.createdAt,
                  kind: i.campaignSlug ? "campaign gift" : "tip / gift",
                  sats: Math.floor(i.amountMsats / 1000),
                  detail: i.comment ? `“${i.comment}”` : i.source,
                  state: i.settledAt ? "paid" : "unpaid",
                })),
                ...portal.orders.map((o) => ({
                  at: o.createdAt,
                  kind: "order",
                  sats: o.totalSats,
                  detail: o.id,
                  state: o.state,
                })),
                ...portal.invoices.map((i) => ({
                  at: i.createdAt,
                  kind: i.kind === "request" ? "payment link" : "invoice",
                  sats: i.amountSats ?? 0,
                  detail: `${i.number} · ${i.payerName}`,
                  state: i.status,
                })),
              ]
                .sort((a, b) => b.at.localeCompare(a.at))
                .map((t) => (
                  <tr key={`${t.kind}-${t.detail}-${t.at}`}>
                    <td>{t.at.slice(0, 16).replace("T", " ")}</td>
                    <td>{t.kind}</td>
                    <td>{fmtSats(t.sats)}</td>
                    <td>{t.detail}</td>
                    <td>
                      <span className={`mp__pill mp__pill--${t.state}`}>{t.state}</span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        ) : (
          <Empty title="No Transactions">
            <Link href={portalHref(portal, "pos")} className="mp__btn">
              Create new Transaction
            </Link>
          </Empty>
        )}
      </Panel>
    </PortalShell>
  )
}
