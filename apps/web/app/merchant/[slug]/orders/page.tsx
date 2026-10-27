import { Empty, Panel, PortalShell, Rows, portalHref } from "@/components/merchant/PortalShell"
import { fmtDate, fmtSats, fmtUsd } from "@/lib/merchant/service"
import Link from "next/link"
import { NotFound, loadPortal } from "../_shared"

export const dynamic = "force-dynamic"
export const metadata = { title: "Orders · Agentic Bitcoin" }

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
    <PortalShell portal={portal} active="orders" title="Orders">
      <Panel
        title="Orders"
        wide
        action={<span className="mp__muted">{portal.orders.length} total</span>}
      >
        {portal.orders.length ? (
          <table className="mp__table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Items</th>
                <th>Total</th>
                <th>State</th>
                <th>Ship to</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {portal.orders.map((o) => (
                <tr key={o.id}>
                  <td>
                    <a href={`/shop/orders/${o.id}`}>{o.id}</a>
                  </td>
                  <td>{o.items.map((i) => `${i.qty}× ${i.title}`).join(", ")}</td>
                  <td>
                    {fmtUsd(o.totalCents)} · {fmtSats(o.totalSats)}
                  </td>
                  <td>
                    <span className={`mp__pill mp__pill--${o.state}`}>{o.state}</span>
                  </td>
                  <td>
                    {o.shipping
                      ? `${o.shipping.name}, ${o.shipping.city}, ${o.shipping.country}`
                      : "—"}
                  </td>
                  <td>{fmtDate(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty title="No Orders">
            <p className="mp__muted">
              Orders appear here when someone checks out at your store. Mark them fulfilled under
              Checkout.
            </p>
          </Empty>
        )}
      </Panel>
    </PortalShell>
  )
}
