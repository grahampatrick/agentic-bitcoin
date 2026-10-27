import { Empty, Panel, PortalShell, Rows, portalHref } from "@/components/merchant/PortalShell"
import { fmtDate, fmtSats, fmtUsd } from "@/lib/merchant/service"
import Link from "next/link"
import { NotFound, loadPortal } from "../_shared"

export const dynamic = "force-dynamic"
export const metadata = { title: "Contacts · Agentic Bitcoin" }

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
    <PortalShell portal={portal} active="contacts" title="Contacts">
      <Panel
        title="Contacts"
        wide
        action={<span className="mp__muted">people you have invoiced</span>}
      >
        {portal.invoices.length ? (
          <table className="mp__table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th>Invoices</th>
                <th>Paid</th>
              </tr>
            </thead>
            <tbody>
              {Object.values(
                portal.invoices.reduce<
                  Record<string, { name: string; contact?: string; n: number; paidCents: number }>
                >((acc, i) => {
                  const k = i.payerName.toLowerCase()
                  const c = acc[k] ?? {
                    name: i.payerName,
                    contact: i.payerContact,
                    n: 0,
                    paidCents: 0,
                  }
                  c.n += 1
                  if (i.status === "paid") c.paidCents += i.totalCents
                  if (!c.contact && i.payerContact) c.contact = i.payerContact
                  acc[k] = c
                  return acc
                }, {}),
              ).map((c) => (
                <tr key={c.name}>
                  <td>{c.name}</td>
                  <td>{c.contact ?? "—"}</td>
                  <td>{c.n}</td>
                  <td>{fmtUsd(c.paidCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty title="No Contacts">
            <p className="mp__muted">
              Contacts are the people on your invoices and payment links. Their details are sealed;
              only this portal can read them.
            </p>
          </Empty>
        )}
      </Panel>
    </PortalShell>
  )
}
