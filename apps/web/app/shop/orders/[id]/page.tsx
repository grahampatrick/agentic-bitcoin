import { OrderStatus } from "@/components/shop/OrderStatus"
import { ShopShell } from "@/components/shop/ShopShell"

export const dynamic = "force-dynamic"

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <ShopShell active="orders">
      <h1 style={{ fontSize: 28 }}>Order</h1>
      <div style={{ maxWidth: 520 }}>
        <OrderStatus id={id} />
      </div>
    </ShopShell>
  )
}
