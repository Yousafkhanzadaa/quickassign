# syntax=docker/dockerfile:1
# Build context: repository root.
FROM node:24-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter @qa/worker...
COPY packages/core packages/core
COPY apps/worker apps/worker
RUN pnpm --filter @qa/core build \
 && pnpm --filter @qa/core test \
 && pnpm --filter @qa/worker build \
 && pnpm --filter @qa/worker test \
 && pnpm --filter @qa/worker deploy --prod --legacy /out

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out /app
COPY db/migrations /app/db/migrations
USER node
CMD ["node", "dist/main.js"]
