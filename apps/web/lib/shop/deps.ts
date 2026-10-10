import { getPrice } from "../price/feed"
import { siteBaseUrl } from "../receive/service"
import { getReceiveStore } from "../receive/store"
import type { ShopDeps } from "./service"
import { getOrderStore, getProductStore } from "./store"

export async function price() {
  try {
    const q = await getPrice()
    return { usdCentsPerBtc: BigInt(q.usdCents), asOf: q.asOf, source: q.source }
  } catch {
    return undefined
  }
}

export function shopDepsFor(req?: Request): ShopDeps {
  return {
    products: getProductStore(),
    orders: getOrderStore(),
    receive: getReceiveStore(),
    price,
    baseUrl: siteBaseUrl(req),
  }
}
