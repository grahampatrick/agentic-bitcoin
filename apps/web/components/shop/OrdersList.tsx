"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { myOrders } from "./cart"

export function OrdersList() {
  const [ids, setIds] = useState<string[] | null>(null)
  useEffect(() => setIds(myOrders()), [])
  if (ids === null) return <p className="muted">Loading…</p>
  if (!ids.length)
    return (
      <p className="muted">
        No orders on this device yet. Orders made by text show up with /orders in chat.
      </p>
    )
  return (
    <ul style={{ listStyle: "none", padding: 0 }}>
      {ids.map((id) => (
        <li key={id} style={{ padding: "8px 0" }}>
          <Link href={`/shop/orders/${id}`}>
            <strong>{id}</strong>
          </Link>
        </li>
      ))}
    </ul>
  )
}
