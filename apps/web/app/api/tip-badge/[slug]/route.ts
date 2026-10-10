/** A small SVG badge for the embeddable tip button. No lookup: the slug is only text on the badge. */
export const runtime = "nodejs"

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const safe = slug.replace(/[^a-z0-9-]/g, "").slice(0, 32)
  const label = `Tip ${safe} in sats`
  const width = 24 + label.length * 7.2 + 24
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width)}" height="32" viewBox="0 0 ${Math.round(width)} 32" role="img" aria-label="${label}">
  <rect width="100%" height="100%" rx="16" fill="#1f2322"/>
  <path d="M18 7 12 17h5l-1 8 6-10h-5z" fill="#f7931a"/>
  <text x="30" y="21" font-family="Inter, system-ui, sans-serif" font-size="13" fill="#fff">${label}</text>
</svg>`
  return new Response(svg, {
    headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" },
  })
}
