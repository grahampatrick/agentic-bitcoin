import type { ProductView } from "@/lib/shop/service"
import Link from "next/link"

export const usd = (cents: number) => `$${(cents / 100).toFixed(2)}` // money-ok: display of an integer-cent value
export const sats = (n?: number) => (n === undefined ? "" : `${n.toLocaleString("en-US")} sats`)

export function ProductCard({ p }: { p: ProductView }) {
  return (
    <Link href={`/shop/p/${p.merchantSlug}/${p.id}`} className="card">
      <div className="card__img">
        {p.imageUrl ? <img src={p.imageUrl} alt="" loading="lazy" /> : <span>{p.title}</span>}
        {p.saveCents ? (
          <span className="save-pill">Save {usd(p.saveCents).replace(/\.00$/, "")}</span>
        ) : null}
      </div>
      <div className="card__body">
        <p className="card__title">{p.title}</p>
        <p className="card__price">
          <strong>{usd(p.payCents)}</strong>
          {p.saveCents ? <s>{usd(p.priceCents)}</s> : null}
        </p>
        <p className="card__sats">
          {sats(p.paySats)} · {p.merchantName}
        </p>
      </div>
    </Link>
  )
}
