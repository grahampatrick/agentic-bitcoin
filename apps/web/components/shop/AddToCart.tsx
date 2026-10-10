"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { addToCart } from "./cart"

export function AddToCart({ gid, inStock }: { gid: string; inStock: boolean }) {
  const [qty, setQty] = useState(1)
  const [added, setAdded] = useState(false)
  const router = useRouter()
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <span className="qty">
        <button type="button" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Fewer">
          −
        </button>
        <span>{qty}</span>
        <button type="button" onClick={() => setQty(Math.min(99, qty + 1))} aria-label="More">
          +
        </button>
      </span>
      <button
        type="button"
        className="btn btn--ghost"
        disabled={!inStock}
        onClick={() => {
          addToCart(gid, qty)
          setAdded(true)
        }}
      >
        {added ? "Added" : "Add to cart"}
      </button>
      <button
        type="button"
        className="btn"
        disabled={!inStock}
        onClick={() => {
          addToCart(gid, qty)
          router.push("/shop/cart")
        }}
      >
        Buy now
      </button>
    </div>
  )
}
