import { siteBaseUrl } from "../receive/service"
import { getReceiveStore } from "../receive/store"
import { price } from "../shop/deps"
import type { InvoiceDeps } from "./service"
import { getInvoiceStore } from "./store"

export function invoiceDepsFor(req?: Request): InvoiceDeps {
  return {
    invoices: getInvoiceStore(),
    receive: getReceiveStore(),
    price,
    baseUrl: siteBaseUrl(req),
  }
}
