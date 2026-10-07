import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: { "@": new URL("./", import.meta.url).pathname },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "lib/**/*.test.tsx"],
    coverage: {
      include: ["lib/**/*.ts"],
      exclude: ["lib/**/*.test.ts"],
    },
  },
})
