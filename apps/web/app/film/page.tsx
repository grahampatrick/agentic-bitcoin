import { LegalLinks, SiteHeader } from "@/components/SiteFrame"
import { Film } from "@/components/film/Film"
import type { Metadata } from "next"
import Link from "next/link"
import "../page.css"
import "./film.css"

export const metadata: Metadata = {
  title: "Watch it work",
  description:
    "Two short scenes: a card with a limit buys a party, and a shop run that waits for your yes on every order. Plain words, no commands.",
}

export default function FilmPage({ searchParams }: { searchParams?: Promise<{ scene?: string }> }) {
  return <FilmBody params={searchParams} />
}

async function FilmBody({ params }: { params?: Promise<{ scene?: string }> }) {
  const p = (await params) ?? {}
  return (
    <>
      <SiteHeader />
      <main className="page page--film">
        <div className="film__intro">
          <h1>Watch it work.</h1>
          <p>
            You text in plain words. It asks once for what it needs, buys within the limit you set,
            and stops at the line. Over the line it waits for your yes. Every sat it moves is in
            your ledger with a receipt.
          </p>
          <p className="small">
            Scripted, not live: the words and the numbers are a story at the sandbox rate. The{" "}
            <Link href="/demo">sandbox</Link> runs the real rules with fake sats.
          </p>
        </div>
        <Film initial={p.scene} />
      </main>
      <LegalLinks />
    </>
  )
}
