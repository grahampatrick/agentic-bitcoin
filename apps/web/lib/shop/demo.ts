/**
 * The keyless demo catalogue (no database): fictional merchants and products so /shop is a real,
 * browsable store on a fresh deploy. Nothing here is a real listing; checkout on these merchants
 * mints invoices via their (fictional) Lightning addresses and will fail honestly.
 */
import type { Recipient, ShopProduct } from "@agentic-bitcoin/core"

const at = "2026-10-10T00:00:00.000Z"
export const DEMO_MERCHANTS: Recipient[] = [
  {
    slug: "reformation-books",
    kind: "merchant",
    name: "Reformation Books",
    lightningAddress: "pay@reformation-books.example",
    verified: { how: "domain", at },
    website: "https://reformation-books.example",
    country: "US",
    description: "Theology, commentaries and study bibles.",
  },
  {
    slug: "north-fork-apparel",
    kind: "merchant",
    name: "North Fork Apparel",
    lightningAddress: "shop@north-fork.example",
    verified: { how: "operator", at },
    country: "US",
    description: "Tees, caps and hoodies, printed to order.",
  },
  {
    slug: "hearth-and-home",
    kind: "merchant",
    name: "Hearth & Home",
    lightningAddress: "orders@hearth.example",
    verified: { how: "operator", at },
    country: "US",
    description: "Candles, mugs and the small things.",
  },
  {
    slug: "little-sprouts",
    kind: "merchant",
    name: "Little Sprouts",
    lightningAddress: "hello@sprouts.example",
    verified: { how: "operator", at },
    country: "US",
    description: "Books and toys for small people.",
  },
  {
    slug: "summit-sports",
    kind: "merchant",
    name: "Summit Sports",
    lightningAddress: "pay@summit.example",
    verified: { how: "operator", at },
    country: "US",
    description: "Trail, climb, run.",
  },
]

const p = (
  merchantSlug: string,
  id: string,
  title: string,
  category: ShopProduct["category"],
  priceCents: number,
  over: Partial<ShopProduct> = {},
): ShopProduct => ({
  id,
  merchantSlug,
  title,
  category,
  priceCents: BigInt(priceCents),
  kind: "physical",
  inStock: true,
  ...over,
})

export const DEMO_PRODUCTS: ShopProduct[] = [
  p("reformation-books", "esv-study-bible", "ESV Study Bible", "books", 49_99, {
    dealCents: 39_99n,
    description: "Hardcover, 2,752 pages of notes, maps and articles.",
  }),
  p(
    "reformation-books",
    "psalms-commentary",
    "The Psalms: A Christ-Centered Commentary",
    "books",
    80_00,
    { description: "Four volumes, cloth." },
  ),
  p(
    "reformation-books",
    "nt-exegesis",
    "How to Understand and Apply the New Testament",
    "books",
    34_36,
    { description: "Twelve steps from exegesis to theology." },
  ),
  p("reformation-books", "beholding-christ", "Beholding Christ", "books", 19_99),
  p("reformation-books", "greek-syntax-ebook", "Greek Syntax (ebook)", "books", 19_99, {
    kind: "digital",
    dealCents: 9_99n,
    description: "Delivered as a download link in your order note.",
  }),
  p("reformation-books", "leather-journal", "Leather journal", "books", 174_68, {
    description: "Full-grain, 400 pages.",
  }),
  p("north-fork-apparel", "classic-tee", "Classic tee", "apparel", 24_00, {
    dealCents: 19_00n,
    description: "100% cotton, printed to order.",
  }),
  p("north-fork-apparel", "crewneck", "Heavyweight crewneck", "apparel", 58_00, {
    dealCents: 18_00n,
  }),
  p("north-fork-apparel", "wool-cap", "Wool cap", "apparel", 30_00, { dealCents: 10_00n }),
  p("north-fork-apparel", "trail-socks", "Trail socks (3 pack)", "apparel", 21_00),
  p("hearth-and-home", "soy-candle", "Soy candle, cedar", "home", 18_00),
  p("hearth-and-home", "stoneware-mug", "Stoneware mug", "home", 22_00, { dealCents: 15_00n }),
  p("hearth-and-home", "linen-apron", "Linen apron", "home", 44_00),
  p("little-sprouts", "wooden-blocks", "Wooden blocks (40)", "kids", 36_00),
  p("little-sprouts", "picture-bible", "Picture bible", "kids", 16_99, { dealCents: 12_99n }),
  p("summit-sports", "trail-cap", "Trail running cap", "sports", 28_00, { dealCents: 20_00n }),
  p("summit-sports", "chalk-bag", "Chalk bag", "sports", 19_00),
  p("summit-sports", "gps-watch-band", "Watch band, 22mm", "sports", 14_00),
]
