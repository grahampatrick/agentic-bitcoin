# Agentic Bitcoin bot: Telegram or Signal surface + scheduler. Build from the repo root:
#   docker build -f apps/bot/Dockerfile -t agentic-bitcoin-bot .
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/bot/package.json apps/bot/
COPY packages/core/package.json packages/core/
COPY packages/fixtures/package.json packages/fixtures/
COPY packages/rails/package.json packages/rails/
COPY packages/scheduler/package.json packages/scheduler/
COPY packages/agent/package.json packages/agent/
COPY packages/mcp/package.json packages/mcp/
COPY packages/brand/package.json packages/brand/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @agentic-bitcoin/bot...
COPY . .
ENV NODE_ENV=production
USER node
CMD ["pnpm", "--filter", "@agentic-bitcoin/bot", "start"]
