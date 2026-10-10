import { COPY } from "@/lib/copy"
import Link from "next/link"
import { Logo } from "./Logo"

/** Header (logo only) + legal footer, exactly the instinct.com frame. */
export function SiteHeader() {
  return (
    <header className="site-header">
      <Link href="/" className="site-header__home" aria-label="Agentic Bitcoin home">
        <Logo className="site-header__logo" />
      </Link>
    </header>
  )
}

export function LegalLinks() {
  const f = COPY.footer
  return (
    <div className="legal-links">
      <p className="legal-links__copyright">{f.copyright}</p>
      <nav className="legal-links__nav" aria-label="Legal">
        <Link href="/privacy">{f.privacy}</Link>
        <Link href="/terms">{f.terms}</Link>
        <Link href="/demo">{f.demo}</Link>
        <Link href="/give">{f.give}</Link>
        <Link href="/receive">{f.receive}</Link>
        <a href={f.sourceUrl} rel="noopener">
          {f.source}
        </a>
      </nav>
      <p className="legal-links__note">{f.note}</p>
    </div>
  )
}
