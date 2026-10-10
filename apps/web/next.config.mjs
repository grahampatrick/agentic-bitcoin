/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transpile the workspace brand package (ships raw TS, no build step for JS consumers).
  transpilePackages: [
    "@agentic-bitcoin/brand",
    "@agentic-bitcoin/agent",
    "@agentic-bitcoin/core",
    "@agentic-bitcoin/rails",
  ],
  // the agent package pulls in the Anthropic SDK and the rails pull in the Alby SDK; keep them server-only
  serverExternalPackages: ["@anthropic-ai/sdk", "@getalby/sdk", "@getalby/lightning-tools"],
  async rewrites() {
    // LNURL-pay discovery lives at a dotted path the app router cannot express.
    return [{ source: "/.well-known/lnurlp/:slug", destination: "/api/lnurlp/:slug" }]
  },
}

export default nextConfig
