import { invoiceDepsFor } from "@/lib/invoices/deps"
import {
  type InvoiceForm,
  createRecipientInvoice,
  recipientInvoiceAction,
  recipientInvoices,
  recipientInvoicesCsv,
} from "@/lib/invoices/service"
import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  let body: {
    token: string
    create?: InvoiceForm
    action?: { id: string; action: "void" | "mark_paid" }
    csv?: boolean
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ ok: false, error: "Expected JSON" }, { status: 400 })
  }
  const deps = invoiceDepsFor(req)
  const token = body.token ?? ""
  if (body.create) {
    const r = await createRecipientInvoice(deps, slug, token, body.create)
    return NextResponse.json(r, { status: r.ok ? 201 : 400 })
  }
  if (body.action) {
    const r = await recipientInvoiceAction(deps, slug, token, body.action.id, body.action.action)
    return NextResponse.json(r, { status: r.ok ? 200 : 400 })
  }
  if (body.csv) {
    const csv = await recipientInvoicesCsv(deps, slug, token)
    return csv === null
      ? NextResponse.json({ ok: false, error: "Not authorized." }, { status: 400 })
      : new NextResponse(csv, { headers: { "content-type": "text/csv" } })
  }
  const list = await recipientInvoices(deps, slug, token)
  return list
    ? NextResponse.json({ ok: true, invoices: list })
    : NextResponse.json({ ok: false, error: "Not authorized." }, { status: 400 })
}
