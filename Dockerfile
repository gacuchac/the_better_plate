# Single hosted service (ADR-001): the API serves the built PWA from the same origin.
FROM node:22-slim
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @betterplate/web build \
 && pnpm --filter @betterplate/api build
ENV NODE_ENV=production SERVE_WEB=true BETTERPLATE_SKIP_ENV_FILE=1
EXPOSE 8080
CMD ["node", "apps/api/dist/server.mjs"]
