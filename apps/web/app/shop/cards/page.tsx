import { CardBuilder } from "@/components/shop/CardBuilder"
import { ShopShell } from "@/components/shop/ShopShell"
import { getPrice } from "@/lib/price/feed"
import { shopDepsFor } from "@/lib/shop/deps"
import { listMerchants } from "@/lib/shop/service"
import { isDemoCatalogue } from "@/lib/shop/store"
import { periodEnd } from "@agentic-bitcoin/core"
import type { Metadata } from "next"
import Link from "next/link"
import "../../card/[id]/card.css"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Virtual cards · Agentic Bitcoin",
  description:
    "A monthly budget on your own wallet for one kind of spend. Nothing is deposited on it.",
}

export default async function CardsPage() {
  const now = new Date()
  const [merchants, price] = await Promise.all([
    listMerchants(shopDepsFor()),
    getPrice().catch(() => null),
  ])
  const resetsAtFor: Record<number, string> = {}
  for (let d = 1; d <= 28; d++) resetsAtFor[d] = periodEnd({ resetDay: d }, now)
  return (
    <ShopShell active="cards">
      <h1 style={{ fontSize: 28, marginBottom: 6 }}>Virtual Lightning cards</h1>
      <p className="muted" style={{ maxWidth: 640 }}>
        A card is a monthly budget on your own wallet for one kind of spend: Steam, one store, a
        paid API, giving, or everything. Nothing is deposited on it, so there is nothing to lose and
        nothing to top up. Pause it from its page in one tap.
      </p>
      {!process.env.SUPABASE_URL ? (
        <p className="demo-note">
          Demo: without a database, cards made here last only as long as this server instance. The
          flow is real; the storage is not yet.
        </p>
      ) : null}
      <CardBuilder
        shops={merchants.map((m) => ({ slug: m.slug, name: m.name }))}
        satsPerDollar={price?.satsPerDollar ?? null}
        resetsAtFor={resetsAtFor}
      />
      <p className="muted" style={{ marginTop: 32 }}>
        Prefer chat? Text “create a virtual card for steam with a 50,000 sat monthly limit”.{" "}
        <Link href="/text">Not texting yet?</Link>
        {isDemoCatalogue() ? " The store in the “A store” option is the demo catalogue." : null}
      </p>
    </ShopShell>
  )
}
