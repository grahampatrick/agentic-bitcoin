"use client"

import { useEffect, useState } from "react"
import { cartCount, onCartChange } from "./cart"

export function CartBadge() {
  const [n, setN] = useState(0)
  useEffect(() => {
    setN(cartCount())
    return onCartChange(() => setN(cartCount()))
  }, [])
  return n > 0 ? <span className="shop__badge">{n}</span> : null
}
