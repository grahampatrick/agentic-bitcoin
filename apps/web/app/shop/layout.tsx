import type { Metadata } from "next"
import "./shop.css"

export const metadata: Metadata = {
  title: "Shop · Agentic Bitcoin",
  description:
    "A store where every price is in sats and every invoice comes from the merchant's own wallet.",
}

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return children
}
