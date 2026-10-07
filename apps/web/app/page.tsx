import { LivePrice } from "@/components/LivePrice"
import { ReactionIcon } from "@/components/ReactionIcon"
import { ReactionTracker } from "@/components/ReactionTracker"
import { LegalLinks, SiteHeader } from "@/components/SiteFrame"
import { Chevron } from "@/components/WaitlistForm"
import { COPY, TASKS } from "@/lib/copy"
import { type PriceQuote, getPrice } from "@/lib/price/feed"
import Link from "next/link"
import "./home.css"

export const dynamic = "force-dynamic"

export default async function Home() {
  let initial: PriceQuote | null = null
  try {
    initial = await getPrice()
  } catch (err) {
    console.error("[home] price unavailable at render:", err instanceof Error ? err.message : err)
  }

  const h = COPY.headline
  const i = COPY.interface

  return (
    <>
      <SiteHeader />
      <main className="home">
        <div className="home__wrapper">
          <div className="home__intro">
            <h1 className="body-semi">
              <strong>
                {h.before}
                {h.quote}
                {h.after}
              </strong>
            </h1>
            <p className="body-reg">
              {i.a}
              {i.quoteA}
              {i.b}
              {i.quoteB}
              {i.c}
            </p>
            <p className="body-reg home__examples">
              <ReactionTracker />
              {COPY.examplesLead}
              {TASKS.map((t, idx) => (
                <span key={t.icon}>
                  {idx === TASKS.length - 1 ? "or " : ""}
                  <span className="home__task">
                    {t.text}
                    <span className="reaction-anchor" aria-hidden="true">
                      <span className="reaction">
                        <span className="reaction__icon">
                          <ReactionIcon icon={t.icon} />
                        </span>
                      </span>
                    </span>
                  </span>
                  {idx < TASKS.length - 1 ? ", " : "."}
                </span>
              ))}
            </p>
            <p className="body-reg home__cta">
              <Link href="/text" className="cta">
                {COPY.cta}
                <span className="cta__chevron" aria-hidden="true">
                  <Chevron />
                </span>
              </Link>
            </p>
            <LivePrice initial={initial} />
          </div>
        </div>
        <LegalLinks />
      </main>
    </>
  )
}
