import { Checkout } from "@/components/shop/Checkout"
import { ShopShell } from "@/components/shop/ShopShell"
import { shopDepsFor } from "@/lib/shop/deps"
import { notFound } from "next/navigation"

export const dynamic = "force-dynamic"

export default async function CheckoutPage({ params }: { params: Promise<{ merchant: string }> }) {
  const { merchant } = await params
  const m = await shopDepsFor().receive.getRecipient(merchant)
  if (!m || m.kind !== "merchant") notFound()
  return (
    <ShopShell active="cart">
      <h1 style={{ fontSize: 28 }}>Checkout</h1>
      <Checkout merchantSlug={m.slug} merchantName={m.name} />
    </ShopShell>
  )
}
