import { OrdersList } from "@/components/shop/OrdersList"
import { ShopShell } from "@/components/shop/ShopShell"

export const dynamic = "force-dynamic"

export default function OrdersPage() {
  return (
    <ShopShell active="orders">
      <h1 style={{ fontSize: 28 }}>Orders</h1>
      <OrdersList />
    </ShopShell>
  )
}
