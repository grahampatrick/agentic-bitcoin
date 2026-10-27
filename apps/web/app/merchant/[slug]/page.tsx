import { Empty, Panel, PortalShell, Rows, portalHref } from "@/components/merchant/PortalShell"
import { fmtDate, fmtSats, fmtUsd } from "@/lib/merchant/service"
import Link from "next/link"
import { NotFound, loadPortal } from "./_shared"

export const dynamic = "force-dynamic"
export const metadata = { title: "Home · Agentic Bitcoin" }

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
    <PortalShell portal={portal} active="home" title="Home">
      {portal.recipient.verified ? null : (
        <p className="mp__banner">
          <strong>Pending verification.</strong> Your pages work now; you appear in the directory
          once the operator verifies you.
        </p>
      )}
      <Panel
        title="Income Summary"
        wide
        action={<span className="mp__muted">all time · at today's price</span>}
      >
        <div className="mp__income">
          <div>
            <p className="mp__k">Sats received</p>
            <p className="mp__big">{portal.income.satsReceived.toLocaleString("en-US")}</p>
            <p className="mp__muted">
              Accounted value:{" "}
              {portal.income.usdCents === null ? "—" : fmtUsd(portal.income.usdCents)}
            </p>
          </div>
          <div>
            <p className="mp__k">Payments</p>
            <p className="mp__big">{portal.income.payments}</p>
            <p className="mp__muted">
              tips {fmtSats(portal.income.tipsSats)} · orders {fmtSats(portal.income.ordersSats)} ·
              invoices {fmtSats(portal.income.invoicesSats)}
            </p>
          </div>
          <div className="mp__income-side">
            <p className="mp__k">Held by</p>
            <p className="mp__big mp__big--sm">Your wallet</p>
            <p className="mp__muted">
              Every invoice is minted by your own wallet. We never hold a sat.
            </p>
          </div>
        </div>
      </Panel>
      <div className="mp__grid">
        <Panel title="Orders">
          {portal.orders.length ? (
            <ul className="mp__list">
              {portal.orders.slice(0, 5).map((o) => (
                <li key={o.id}>
                  <span>
                    {o.id} · {o.items.map((i) => i.title).join(", ")}
                  </span>
                  <span className={`mp__pill mp__pill--${o.state}`}>{o.state}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No Orders">
              {portal.recipient.kind === "merchant" ? (
                <Link href={portalHref(portal, "checkout")} className="mp__btn">
                  Add products
                </Link>
              ) : null}
            </Empty>
          )}
        </Panel>
        <Panel title="Transactions">
          {portal.received.length ? (
            <ul className="mp__list">
              {portal.received.slice(0, 5).map((i) => (
                <li key={i.paymentHash}>
                  <span>
                    {fmtSats(Math.floor(i.amountMsats / 1000))}
                    {i.comment ? ` · “${i.comment}”` : ""}
                  </span>
                  <span
                    className={`mp__pill ${i.settledAt ? "mp__pill--paid" : "mp__pill--unpaid"}`}
                  >
                    {i.settledAt ? "settled" : "unpaid"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No Transactions">
              <Link href={portalHref(portal, "pos")} className="mp__btn">
                Create new Transaction
              </Link>
            </Empty>
          )}
        </Panel>
        <Panel title="Payment Links">
          {portal.invoices.filter((i) => i.kind === "request").length ? (
            <ul className="mp__list">
              {portal.invoices
                .filter((i) => i.kind === "request")
                .slice(0, 5)
                .map((i) => (
                  <li key={i.id}>
                    <span>
                      {i.number} · {i.payerName} · {fmtUsd(i.totalCents)}
                    </span>
                    <span className={`mp__pill mp__pill--${i.status}`}>{i.status}</span>
                  </li>
                ))}
            </ul>
          ) : (
            <Empty title="No Payment Links">
              <Link href={portalHref(portal, "links")} className="mp__btn">
                Create a payment link
              </Link>
            </Empty>
          )}
        </Panel>
        <Panel title="Invoices">
          {portal.invoices.filter((i) => i.kind === "invoice").length ? (
            <ul className="mp__list">
              {portal.invoices
                .filter((i) => i.kind === "invoice")
                .slice(0, 5)
                .map((i) => (
                  <li key={i.id}>
                    <span>
                      {i.number} · {i.payerName} · {fmtUsd(i.totalCents)}
                    </span>
                    <span className={`mp__pill mp__pill--${i.status}`}>{i.status}</span>
                  </li>
                ))}
            </ul>
          ) : (
            <Empty title="No Invoices">
              <Link href={portalHref(portal, "invoices")} className="mp__btn">
                Create an invoice
              </Link>
            </Empty>
          )}
        </Panel>
        <Panel title="Subscription">
          <Rows
            rows={[
              ["Plan", "Pilot"],
              [
                "Status",
                <span key="s" className="mp__ok">
                  Active ✓
                </span>,
              ],
              [
                "Activated",
                fmtDate(portal.recipient.submittedAt ?? portal.recipient.verifiedDetail?.at),
              ],
              ["Price", "Free during the pilot"],
            ]}
          />
        </Panel>
        <Panel title="Market">
          <Rows
            rows={[
              ["Price (USD)", portal.price ? fmtUsd(portal.price.usdCents) : "—"],
              [
                "Sats per USD",
                portal.price ? portal.price.satsPerDollar.toLocaleString("en-US") : "—",
              ],
              [
                "USD per sat",
                portal.price ? `$${(1 / portal.price.satsPerDollar).toFixed(8)}` : "—",
              ],
              [
                "Source",
                portal.price
                  ? `${portal.price.source}${portal.price.stale ? " (stale)" : ""}`
                  : "—",
              ],
            ]}
          />
        </Panel>
      </div>
      <Panel title="Discover" wide>
        <div className="mp__discover">
          <article>
            <span className="mp__tag">Feature</span>
            <h3>Point of sale</h3>
            <p>
              Type an amount, show the QR, get paid to your own wallet. Works on a phone at the
              counter.
            </p>
            <Link href={portalHref(portal, "pos")} className="mp__btn">
              Open POS →
            </Link>
          </article>
          <article>
            <span className="mp__tag">Feature</span>
            <h3>Recurring invoices</h3>
            <p>
              Monthly, weekly or on any schedule, each one minted fresh by your wallet with its own
              pay link.
            </p>
            <Link href={portalHref(portal, "recurring")} className="mp__btn">
              Learn more →
            </Link>
          </article>
          <article>
            <span className="mp__tag mp__tag--pink">Protocol</span>
            <h3>Agents can buy from you</h3>
            <p>
              Your manifest, feed, checkout and order status are served for any agent that speaks
              the Anvard protocol.
            </p>
            <Link href={portalHref(portal, "connections")} className="mp__btn">
              See endpoints →
            </Link>
          </article>
        </div>
      </Panel>
    </PortalShell>
  )
}
