import { PayInvoice } from "@/components/PayInvoice"
import { LegalLinks, SiteHeader } from "@/components/SiteFrame"
import { invoiceDepsFor } from "@/lib/invoices/deps"
import { payView } from "@/lib/invoices/service"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import "../../page.css"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params
  const v = await payView(invoiceDepsFor(), token.toLowerCase())
  return { title: v ? `${v.number} from ${v.issuerName} · Agentic Bitcoin` : "Agentic Bitcoin" }
}

export default async function PayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const v = await payView(invoiceDepsFor(), token.toLowerCase())
  if (!v) notFound()
  return (
    <>
      <SiteHeader />
      <main className="page">
        <h1>
          {v.kind === "request" ? "Payment request" : "Invoice"} {v.number}.
        </h1>
        <p className="small">
          From {v.issuerName} to {v.payerName}
          {v.status === "overdue" ? " · overdue" : ""}
        </p>
        <PayInvoice token={token.toLowerCase()} initial={v} />
        <p className="small">
          The money goes straight to {v.issuerName}&rsquo;s wallet. Agentic Bitcoin never holds it
          and issues no receipts.
        </p>
        <LegalLinks />
      </main>
    </>
  )
}
