import { CartView } from "@/components/shop/CartView"
import { ShopShell } from "@/components/shop/ShopShell"

export const dynamic = "force-dynamic"

export default function CartPage() {
  return (
    <ShopShell active="cart">
      <h1 style={{ fontSize: 28 }}>Your cart</h1>
      <CartView />
    </ShopShell>
  )
}
