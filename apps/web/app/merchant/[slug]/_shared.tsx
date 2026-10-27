import { LegalLinks, SiteHeader } from "@/components/SiteFrame"
import { type Portal, portalFor } from "@/lib/merchant/service"
import "../../page.css"
import "./portal.css"

export const dynamic = "force-dynamic"

export async function loadPortal(
  params: Promise<{ slug: string }>,
  searchParams: Promise<{ t?: string }>,
): Promise<Portal | null> {
  const { slug } = await params
  const { t } = await searchParams
  return portalFor(slug, t ?? "")
}

export function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="page">
        <h1>Not found.</h1>
        <p className="small">
          This portal link is wrong or expired. If you lost yours, contact the operator.
        </p>
        <LegalLinks />
      </main>
    </>
  )
}
