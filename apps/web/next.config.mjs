/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transpile the workspace brand package (ships raw TS, no build step for JS consumers).
  transpilePackages: ["@agentic-bitcoin/brand"],
}

export default nextConfig
