/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transpile the workspace brand package (ships raw TS, no build step for JS consumers).
  transpilePackages: ["@agentic-bitcoin/brand", "@agentic-bitcoin/agent", "@agentic-bitcoin/core"],
  // the agent package pulls in the Anthropic SDK; keep it server-only
  serverExternalPackages: ["@anthropic-ai/sdk"],
}

export default nextConfig
