import type { Metadata, Viewport } from "next"
import localFont from "next/font/local"
import "@agentic-bitcoin/brand/tokens.css"
import "./globals.css"
import { COPY } from "@/lib/copy"

// OFL fonts vendored in ./fonts (ADR-0003): variable latin subsets, licences alongside. No network
// at build time, so Vercel/CI builds are reproducible and contributors need nothing external.
const serif = localFont({
  src: "./fonts/Newsreader-latin-var.woff2",
  weight: "200 800",
  style: "normal",
  variable: "--font-newsreader",
  display: "swap",
})
const sans = localFont({
  src: "./fonts/Inter-latin-var.woff2",
  weight: "100 900",
  style: "normal",
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
