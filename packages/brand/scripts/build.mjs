// Generates packages/brand/tokens.css from src/tokens.ts.
// `node scripts/build.mjs`         -> write tokens.css
// `node scripts/build.mjs --check` -> fail if tokens.css is stale (CI drift guard)
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { tokensToCss } from "../src/tokens.ts"

const here = dirname(fileURLToPath(import.meta.url))
const outPath = join(here, "..", "tokens.css")
const next = tokensToCss()

if (process.argv.includes("--check")) {
  let current = ""
  try {
    current = readFileSync(outPath, "utf8")
  } catch {
    /* missing file → stale */
  }
  if (current !== next) {
    console.error("✗ tokens.css is out of date. Run `pnpm --filter @agentic-bitcoin/brand build`.")
    process.exit(1)
  }
  console.log("✓ tokens.css is up to date")
} else {
  writeFileSync(outPath, next)
  console.log(`✓ wrote ${outPath}`)
}
