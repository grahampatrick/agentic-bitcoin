import type { Metadata, Viewport } from "next"
import { Inter, Newsreader } from "next/font/google"
import "@agentic-bitcoin/brand/tokens.css"
import "./globals.css"
import { COPY } from "@/lib/copy"

// OFL fonts, self-hosted at build time by next/font (ADR-0003). No requests to Google at runtime.
const serif = Newsreader({
  subsets: ["latin"],
  weight: ["400", "600"],
  style: ["normal"],
  variable: "--font-newsreader",
  display: "swap",
})
const sans = Inter({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-inter",
  display: "swap",
})

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3900"

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: COPY.title,
  description: COPY.description,
  openGraph: { title: COPY.title, description: COPY.description, type: "website" },
}

export const viewport: Viewport = {
  themeColor: "#f4efec",
  width: "device-width",
  initialScale: 1,
}

// Reveal gate: with JS, hide the intro until fonts are ready, then stagger it in. Without JS the
// attribute is never set and everything is simply visible. The script mutates <html> before React
// hydrates; React 19 diffs even extra attributes there, hence suppressHydrationWarning on <html>.
const revealScript = `document.documentElement.dataset.reveal='pending';(document.fonts&&document.fonts.ready?document.fonts.ready:Promise.resolve()).then(function(){requestAnimationFrame(function(){document.documentElement.dataset.reveal='done'})});`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`} suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static, no user input */}
        <script dangerouslySetInnerHTML={{ __html: revealScript }} />
      </head>
      <body>
        <div className="marketing-site">{children}</div>
      </body>
    </html>
  )
}
