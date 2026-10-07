// Non-negotiable #3: money is integers. This gate greps the money-bearing source dirs for
// identifiers that look like money paired with float-producing expressions, and fails the build.
// It is deliberately simple; the real defence is the typed money helpers in `lib/price` and
// (from M1) `@agentic-bitcoin/core`.
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const roots = ["apps", "packages"]
const skip = new Set(["node_modules", ".next", "dist", "coverage"])
const moneyWord = /\b(sats?|satoshis?|cents|usdCents|amountSats|amountCents)\b/i
const floatSmell = /\b(parseFloat|toFixed)\(|\.\d+\s*\*|\*\s*0\.\d+|\/\s*100(?!_?0)\b(?!\s*\))/

const bad = []
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(ts|tsx|mjs)$/.test(p) && !/\.test\.tsx?$/.test(p)) {
      const lines = readFileSync(p, "utf8").split("\n")
      lines.forEach((line, i) => {
        if (line.includes("money-ok")) return
        if (moneyWord.test(line) && floatSmell.test(line)) bad.push(`${p}:${i + 1}: ${line.trim()}`)
      })
    }
  }
}
for (const r of roots) {
  try {
    walk(r)
  } catch {
    /* missing root is fine */
  }
}
if (bad.length) {
  console.error(
    `✗ money-as-integers gate: float smell next to a money identifier\n${bad.join("\n")}`,
  )
  process.exit(1)
}
console.log("✓ money-as-integers gate passed")
