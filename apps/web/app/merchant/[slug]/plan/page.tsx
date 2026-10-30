import { PlanPayButton } from "@/components/merchant/PlanPayButton"
import { Panel, PortalShell, Rows } from "@/components/merchant/PortalShell"
import { fmtDate, fmtUsd } from "@/lib/merchant/service"
import Link from "next/link"
import { NotFound, loadPortal } from "../_shared"

export const dynamic = "force-dynamic"
export const metadata = { title: "Plan · Agentic Bitcoin" }

type P = { params: Promise<{ slug: string }>; searchParams: Promise<{ t?: string }> }

const LABEL: Record<string, string> = {
  free: "Free",
  pilot: "Pilot",
  active: "Active",
  due: "Payment due",
  lapsed: "Lapsed",
}

export default async function Page({ params, searchParams }: P) {
  const portal = await loadPortal(params, searchParams)
  if (!portal) return <NotFound />
  const p = portal.plan
  const pill =
    p.state === "lapsed"
      ? "mp__pill mp__pill--void"
      : p.state === "due"
        ? "mp__pill mp__pill--overdue"
        : "mp__pill mp__pill--paid"
  const price = p.priceCents ? `${fmtUsd(p.priceCents)} a month, paid in sats` : "Free"
  const untilLabel =
    p.state === "pilot"
      ? "Pilot ends"
      : p.state === "active"
        ? "Paid through"
        : p.state === "free"
          ? "Until"
          : "Was due"
  const canPay = p.state !== "free" && !!p.payee
  return (
    <PortalShell portal={portal} active="plan" title="Plan">
      {p.state === "due" ? (
        <p className="mp__banner">
          <strong>Your plan is due.</strong> Everything stays on until {fmtDate(p.lapsesAt)}. Pay
          any time before then and nothing changes.
        </p>
      ) : p.state === "lapsed" ? (
        <p className="mp__banner">
          <strong>Your plan has lapsed.</strong> Your products are off the shop and checkout is
          closed. Paying turns everything back on the moment it settles.
        </p>
      ) : null}
      <Panel title="Your plan" wide>
        <Rows
          rows={[
            ["Plan", "Shop"],
            [
              "Status",
              <span key="s" className={pill}>
                {LABEL[p.state] ?? p.state}
              </span>,
            ],
            ["Price", price],
            [
              untilLabel,
              `${fmtDate(p.until)}${
                p.daysLeft >= 0 && p.state !== "free" ? ` · ${p.daysLeft} days` : ""
              }`,
            ],
            ...(p.state !== "free"
              ? [
                  [
                    "Grace period",
                    `${p.graceDays} days after the date above; everything stays on until ${fmtDate(p.lapsesAt)}`,
                  ] as [string, React.ReactNode],
                ]
              : []),
            ...(p.payee
              ? [
                  ["Paid to", `${p.payee.name}'s own wallet, as an ordinary invoice`] as [
                    string,
                    React.ReactNode,
                  ],
                ]
              : []),
          ]}
        />
        {canPay ? (
          <p className="mp__plan-actions">
            {p.open ? (
              <>
                <Link href={p.open.link} className="mp__btn mp__btn--solid">
                  Pay {p.open.number} · {fmtUsd(p.open.totalCents)}
                </Link>
                <span className="mp__muted"> open · {p.open.status}</span>
              </>
            ) : (
              <PlanPayButton
                slug={portal.slug}
                token={portal.token}
                label={
                  p.state === "pilot"
                    ? "Pay a month ahead"
                    : p.state === "active"
                      ? "Add a month"
                      : "Pay now"
                }
              />
            )}
          </p>
        ) : p.state === "free" ? (
          <p className="mp__muted">
            This server does not charge for the shop. If that changes, this page is where you will
            see it first.
          </p>
        ) : (
          <p className="mp__muted">
            The operator has not set up a payee yet, so there is nothing to pay.
          </p>
        )}
      </Panel>
      <div className="mp__grid">
        <Panel title="What the plan covers">
          <ul className="mp__list">
            {p.includes.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Panel>
        <Panel title="If it lapses">
          <ul className="mp__list">
            {p.stops.map((x) => (
              <li key={x}>✕ {x}</li>
            ))}
            {p.keeps.map((x) => (
              <li key={x}>✓ {x}</li>
            ))}
          </ul>
        </Panel>
        <Panel title="Payments" wide>
          {p.history.length ? (
            <ul className="mp__list">
              {p.history.map((h) => (
                <li key={h.number}>
                  <span>
                    {h.number} · {fmtDate(h.paidAt)} · {fmtUsd(h.totalCents)}
                  </span>{" "}
                  <Link href={h.link} className="mp__muted">
                    receipt
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mp__muted">
              No plan payments yet.
              {p.state === "pilot" ? " Nothing is owed during the pilot." : ""}
            </p>
          )}
        </Panel>
      </div>
    </PortalShell>
  )
}
