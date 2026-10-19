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
# Migrations and the catalog seed are idempotent and lock-guarded, so running them on every start
# keeps the schema in step with the code even if a platform pre-deploy hook is skipped.
CMD ["sh", "-c", "node apps/api/dist/db/cli.mjs setup && exec node apps/api/dist/server.mjs"]
