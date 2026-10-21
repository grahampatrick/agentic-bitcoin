/**
 * Inventory importers (M16): the files card shops actually have. A dependency-free CSV parser
 * (RFC 4180: quotes, escaped quotes, newlines in quotes) with column detection for the common
 * exports (TCGplayer-style, generic), and Shopify's public products.json. Pure; no I/O.
 */
import type { Cents } from "./money"
import { PRODUCT_ID_RE, type ShopCategory, type ShopProduct, type TcgFields } from "./shop"

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  const src = text.replace(/^﻿/, "")
  for (let i = 0; i < src.length; i++) {
    const c = src[i] as string
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += c
    } else if (c === '"') quoted = true
    else if (c === ",") {
      row.push(cell)
      cell = ""
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ""
    } else cell += c
  }
  if (cell.length || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ""))
}

const norm = (h: string) =>
  h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()

/** Find the first header matching any of the candidates (normalised). */
function col(headers: string[], ...names: string[]): number {
  const hs = headers.map(norm)
  for (const n of names) {
    const i = hs.indexOf(norm(n))
    if (i >= 0) return i
  }
  for (const n of names) {
    const i = hs.findIndex((h) => h.includes(norm(n)))
    if (i >= 0) return i
  }
  return -1
}

export function slugifyId(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
}

export function centsFromText(s: string): Cents | null {
  const t = s.replace(/[$,\s]/g, "")
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  const [d, c = ""] = t.split(".")
  return BigInt(d ?? "0") * 100n + BigInt(c.padEnd(2, "0"))
}

export interface ImportReport {
  products: ShopProduct[]
  skipped: { row: number; reason: string }[]
  columns: Record<string, number>
}

/**
 * CSV → products. Recognises TCGplayer/BinderPOS/Crystal Commerce-style headers (Product Name,
 * Set Name, Number, Condition, Rarity, Price, Quantity, SKU, Image URL, Language, Foil) and generic
 * ones (title, price, qty/stock, category, description, image, sku/id).
 */
export function importProductsCsv(
  csv: string,
  merchantSlug: string,
  opts: { defaultGame?: string; category?: ShopCategory } = {},
): ImportReport {
  const rows = parseCsv(csv)
  const headers = rows[0] ?? []
  const c = {
    title: col(headers, "product name", "title", "name", "card name"),
    set: col(headers, "set name", "set", "edition", "expansion"),
    number: col(headers, "number", "collector number", "card number", "no"),
    condition: col(headers, "condition"),
    rarity: col(headers, "rarity"),
    price: col(
      headers,
      "tcg marketplace price",
      "marketplace price",
      "price",
      "sell price",
      "unit price",
    ),
    qty: col(headers, "total quantity", "quantity", "qty", "stock", "inventory"),
    sku: col(headers, "sku", "tcgplayer id", "product id", "id"),
    image: col(headers, "image url", "image", "photo"),
    language: col(headers, "language", "lang"),
    finish: col(headers, "printing", "finish", "foil"),
    game: col(headers, "product line", "game"),
    description: col(headers, "description", "notes"),
    category: col(headers, "category", "type"),
    grade: col(headers, "grade", "grading"),
    provenance: col(headers, "provenance", "provenance url", "provenance id"),
  }
  const report: ImportReport = { products: [], skipped: [], columns: c }
  if (c.title < 0 || c.price < 0) {
    report.skipped.push({ row: 1, reason: "could not find a title column and a price column" })
    return report
  }
  const seen = new Set<string>()
  rows.slice(1).forEach((r, i) => {
    const rowNo = i + 2
    const get = (k: number) => (k >= 0 ? (r[k] ?? "").trim() : "")
    const title = get(c.title).slice(0, 120)
    if (!title) return report.skipped.push({ row: rowNo, reason: "no title" })
    const price = centsFromText(get(c.price))
    if (price === null || price < 0n)
      return report.skipped.push({ row: rowNo, reason: `bad price "${get(c.price)}"` })
    const set = get(c.set)
    const number = get(c.number)
    const condition = get(c.condition)
    const baseId = get(c.sku) || [title, set, number, condition].filter(Boolean).join(" ")
    let id = slugifyId(baseId)
    if (!PRODUCT_ID_RE.test(id)) return report.skipped.push({ row: rowNo, reason: "no usable id" })
    let n = 2
    while (seen.has(id)) id = `${slugifyId(baseId).slice(0, 58)}-${n++}`
    seen.add(id)
    const qtyText = get(c.qty)
    const qty = qtyText === "" ? 1 : Number.parseInt(qtyText.replace(/[^0-9-]/g, ""), 10)
    const game = (get(c.game) || opts.defaultGame || "").toLowerCase().trim()
    const tcg: TcgFields | undefined =
      game && set
        ? {
            game,
            set,
            number: number || undefined,
            condition: condition || undefined,
            grade: get(c.grade) || undefined,
            finish: get(c.finish) || undefined,
            language: get(c.language) || undefined,
            provenanceUrl: /^https:\/\//.test(get(c.provenance)) ? get(c.provenance) : undefined,
          }
        : undefined
    let imageUrl: string | undefined
    const iu = get(c.image)
    if (/^https:\/\//.test(iu)) imageUrl = iu
    const category: ShopCategory = tcg ? "tcg" : (opts.category ?? "other")
    const descParts = [get(c.description), get(c.rarity) ? `Rarity: ${get(c.rarity)}` : ""].filter(
      Boolean,
    )
    report.products.push({
      id,
      merchantSlug,
      title,
      description: descParts.join(". ").slice(0, 1000) || undefined,
      imageUrl,
      category,
      priceCents: price,
      kind: "physical",
      inStock: Number.isFinite(qty) ? qty > 0 : true,
      tcg,
    })
  })
  return report
}

/** Shopify's public `/products.json` (no auth): one product per variant with a price. */
export function importShopifyProducts(
  json: unknown,
  merchantSlug: string,
  opts: { category?: ShopCategory; defaultGame?: string } = {},
): ImportReport {
  const report: ImportReport = { products: [], skipped: [], columns: {} }
  const list = (json as { products?: unknown[] })?.products
  if (!Array.isArray(list)) {
    report.skipped.push({ row: 0, reason: "not a Shopify products.json" })
    return report
  }
  const seen = new Set<string>()
  list.forEach((p, i) => {
    const o = (p ?? {}) as Record<string, unknown>
    const title = String(o.title ?? "")
      .trim()
      .slice(0, 120)
    const variants = Array.isArray(o.variants) ? (o.variants as Record<string, unknown>[]) : []
    const image =
      Array.isArray(o.images) && o.images[0]
        ? String((o.images[0] as Record<string, unknown>).src ?? "")
        : ""
    if (!title) return report.skipped.push({ row: i, reason: "no title" })
    if (!variants.length) return report.skipped.push({ row: i, reason: "no variants" })
    for (const v of variants) {
      const price = centsFromText(String(v.price ?? ""))
      if (price === null) {
        report.skipped.push({ row: i, reason: `bad price "${String(v.price)}"` })
        continue
      }
      const vTitle = String(v.title ?? "")
      const full = vTitle && vTitle !== "Default Title" ? `${title} — ${vTitle}` : title
      let id = slugifyId(
        String(v.sku ?? "") ||
          String(o.handle ?? "") + (vTitle && vTitle !== "Default Title" ? `-${vTitle}` : ""),
      )
      if (!PRODUCT_ID_RE.test(id)) id = slugifyId(full)
      if (!PRODUCT_ID_RE.test(id)) {
        report.skipped.push({ row: i, reason: "no usable id" })
        continue
      }
      let n = 2
      const base = id
      while (seen.has(id)) id = `${base.slice(0, 58)}-${n++}`
      seen.add(id)
      const tags = Array.isArray(o.tags)
        ? (o.tags as string[]).map(String)
        : String(o.tags ?? "")
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
      const game =
        opts.defaultGame ??
        tags
          .map((t) => t.toLowerCase())
          .find((t) =>
            [
              "pokemon",
              "mtg",
              "magic",
              "yugioh",
              "lorcana",
              "one piece",
              "flesh and blood",
            ].includes(t),
          )
      const setTag = tags.find((t) => /^set:/i.test(t))?.slice(4)
      const tcg: TcgFields | undefined =
        game && setTag
          ? { game: game === "magic" ? "mtg" : game.replace(/\s+/g, "-"), set: setTag }
          : undefined
      report.products.push({
        id,
        merchantSlug,
        title: full.slice(0, 120),
        description:
          String(o.body_html ?? "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 1000) || undefined,
        imageUrl: /^https:\/\//.test(image) ? image : undefined,
        category: tcg ? "tcg" : (opts.category ?? "other"),
        priceCents: price,
        dealCents: (() => {
          const cmp = centsFromText(String(v.compare_at_price ?? ""))
          return cmp !== null && cmp > price ? price : undefined
        })(),
        kind: "physical",
        inStock: v.available !== false,
        tcg,
      })
      if (tcg === undefined && report.products.at(-1)?.dealCents === price) {
        // compare_at is the list price; our model stores the list price and the deal
        const last = report.products.at(-1) as ShopProduct
        last.priceCents = centsFromText(String(v.compare_at_price ?? "")) ?? price
        last.dealCents = price
      }
    }
  })
  return report
}
