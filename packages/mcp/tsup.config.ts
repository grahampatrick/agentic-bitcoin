import { defineConfig } from "tsup"

// One self-contained ESM file for the bin: workspace packages are bundled in, npm deps stay external.
export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  noExternal: [/^@agentic-bitcoin\//],
  banner: { js: "#!/usr/bin/env node" },
})
