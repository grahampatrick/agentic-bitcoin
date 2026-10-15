import { InMemoryInvoiceStore, type InvoiceStore } from "@agentic-bitcoin/core"
import { SupabaseInvoiceStore } from "@agentic-bitcoin/stores"
import { createClient } from "@supabase/supabase-js"

const g = globalThis as { __invoices?: InvoiceStore }
export function getInvoiceStore(): InvoiceStore {
  if (g.__invoices) return g.__invoices
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  g.__invoices =
    url && key
      ? new SupabaseInvoiceStore(createClient(url, key, { auth: { persistSession: false } }))
      : new InMemoryInvoiceStore()
  return g.__invoices
}
export function __setInvoiceStore(s: InvoiceStore | null) {
  g.__invoices = s ?? undefined
}
