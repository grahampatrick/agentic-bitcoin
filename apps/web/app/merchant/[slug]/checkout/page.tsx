import { Empty, Panel, PortalShell, Rows, portalHref } from "@/components/merchant/PortalShell"
import { ImportTools } from "@/components/shop/ImportTools"
import { MerchantTools } from "@/components/shop/MerchantTools"
import { fmtDate, fmtSats, fmtUsd } from "@/lib/merchant/service"
import { getProductStore } from "@/lib/shop/store"
import Link from "next/link"
import { NotFound, loadPortal } from "../_shared"

export const dynamic = "force-dynamic"
export const metadata = { title: "Checkout · Agentic Bitcoin" }

type P = { params: Promise<{ slug: string }>; searchParams: Promise<{ t?: string }> }

export default async function Page({ params, searchParams }: P) {
  const portal = await loadPortal(params, searchParams)
  if (!portal) return <NotFound />
  const products =
    portal.recipient.kind === "merchant"
      ? (await getProductStore().listForMerchant(portal.slug)).map((p) => ({
          id: p.id,
          title: p.title,
          price: (Number(p.priceCents) / 100).toFixed(2), // money-ok: display
          deal: p.dealCents === undefined ? undefined : (Number(p.dealCents) / 100).toFixed(2), // money-ok: display
          category: p.category,
          kind: p.kind,
          inStock: p.inStock,
        }))
      : []
  void fmtDate
  void fmtSats
  void fmtUsd
  void portalHref
  void Link
  void Rows
  void Empty
  return (
    <PortalShell portal={portal} active="checkout" title="Checkout">
      {portal.recipient.kind !== "merchant" ? (
        <Panel title="Checkout" wide>
          <Empty title="Store checkout is for merchants">
            <p className="mp__muted">Your give and tip pages are under Payment Requests.</p>
          </Empty>
        </Panel>
      ) : (
        <>
          <Panel
            title="Your store"
            wide
            action={
              <a className="mp__btn" href={`/shop/m/${portal.slug}`}>
                View store →
              </a>
            }
          >
            <p className="mp__muted">
              {portal.productCount} products listed. Buyers check out at the store; each order's
              invoice is minted by your wallet.
            </p>
            <MerchantTools slug={portal.slug} token={portal.token} products={products} />
          </Panel>
          <Panel title="Import inventory" wide>
            <ImportTools slug={portal.slug} token={portal.token} />
          </Panel>
        </>
      )}
    </PortalShell>
  )
}
