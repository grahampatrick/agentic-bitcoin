import { Empty, Panel, PortalShell, Rows, portalHref } from "@/components/merchant/PortalShell"
import { fmtDate, fmtSats, fmtUsd } from "@/lib/merchant/service"
import Link from "next/link"
import { NotFound, loadPortal } from "../_shared"

export const dynamic = "force-dynamic"
export const metadata = { title: "Connections · Agentic Bitcoin" }

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
    <PortalShell portal={portal} active="connections" title="Connections">
      <Panel title="Wallet" wide>
        <Rows
          rows={[
            [
              "Receive connection",
              portal.recipient.walletConnected ? (
                <span key="w" className="mp__ok">
                  Connected (receive-only NWC) ✓
                </span>
              ) : (
                "Not connected — payments go to your Lightning address"
              ),
            ],
            ["Lightning address", <code key="a">{portal.recipient.lightningAddress}</code>],
            [
              "Settlement visibility",
              portal.recipient.walletConnected
                ? "We can see when invoices settle"
                : "Your wallet app is the record",
            ],
          ]}
        />
        <p className="mp__muted">
          To connect or change the wallet, onboard again at <a href="/receive">/receive</a> with a
          receive-only connection string from Alby Hub or Coinos. Nothing here can spend.
        </p>
      </Panel>
      <Panel title="Agents and the open protocol" wide>
        <Rows
          rows={[
            [
              "Manifest",
              <a key="m" href={`/api/commerce/${portal.slug}/manifest`}>
                {portal.base}/api/commerce/{portal.slug}/manifest
              </a>,
            ],
            [
              "Product feed",
              <a key="p" href={`/api/commerce/${portal.slug}/products`}>
                {portal.base}/api/commerce/{portal.slug}/products
              </a>,
            ],
            [
              "Checkout",
              <code key="c">
                POST {portal.base}/api/commerce/{portal.slug}/checkout
              </code>,
            ],
            [
              "Order status",
              <code key="o">
                GET {portal.base}/api/commerce/orders/{"{id}"}
              </code>,
            ],
            [
              "Remote shop",
              portal.recipient.manifestHost ? (
                <code key="h">{portal.recipient.manifestHost}</code>
              ) : (
                "none — your catalogue lives here"
              ),
            ],
          ]}
        />
        <p className="mp__muted">
          Any agent that reads <code>/.well-known/anvard.json</code> can buy from you with your own
          invoice. Spec:{" "}
          <a href="https://github.com/grahampatrick/agentic-bitcoin/blob/main/docs/protocol/anvard-commerce.md">
            anvard-commerce.md
          </a>
          .
        </p>
      </Panel>
      <Panel title="Storefronts" wide>
        <Rows
          rows={[
            [
              "Anvard store",
              portal.recipient.kind === "merchant" ? (
                <a key="s" href={`/shop/m/${portal.slug}`}>
                  {portal.base}/shop/m/{portal.slug}
                </a>
              ) : (
                "merchants only"
              ),
            ],
            [
              "Shopify / CSV import",
              <Link key="i" href={portalHref(portal, "checkout")}>
                Under Checkout
              </Link>,
            ],
          ]}
        />
      </Panel>
    </PortalShell>
  )
}
