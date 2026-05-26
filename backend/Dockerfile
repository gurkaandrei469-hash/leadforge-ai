# syntax=docker/dockerfile:1
# ────────────────────────────────────────────────────────────────────────
# Multi-stage build for the LeadForge backend. Produces a small Node 22 image
# that runs the compiled TypeScript output. The same image is used for both
# the API server and the BullMQ workers — Railway picks the start command
# per service via railway.json (or the Service Settings UI).
# ────────────────────────────────────────────────────────────────────────

FROM node:22-alpine AS base
WORKDIR /app
# OpenSSL is required by Prisma; libc6-compat helps a couple of native deps
RUN apk add --no-cache openssl libc6-compat tini

# ─── deps stage: install ALL deps (incl. dev) so the build can run ──────
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

# ─── build stage: generate Prisma client + compile TS ───────────────────
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# ─── prod stage: ship only what we need to run ──────────────────────────
FROM base AS prod
ENV NODE_ENV=production
# Reinstall ONLY production deps for a smaller final image
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
# Bring over the Prisma client (regenerated for prod node_modules) + compiled JS + schema
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma

# Apply pending DB migrations on container start, then exec the actual server.
# This way the API container handles schema-up on every deploy — no separate
# migrate step needed in CI.
COPY <<'SH' /app/start-api.sh
#!/bin/sh
set -e
echo "→ Applying database migrations…"
npx prisma migrate deploy
echo "→ Starting API server"
exec node dist/server.js
SH
RUN chmod +x /app/start-api.sh

COPY <<'SH' /app/start-worker.sh
#!/bin/sh
set -e
# Workers don't need to re-run migrations (the API container handles that),
# but they DO need the schema to be up-to-date. In case the worker service
# boots first on a fresh deploy, the deploy is idempotent.
npx prisma migrate deploy || true
echo "→ Starting BullMQ workers"
exec node dist/workers/index.js
SH
RUN chmod +x /app/start-worker.sh

EXPOSE 4000
# Tini reaps zombies + forwards SIGTERM properly for graceful shutdown
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/app/start-api.sh"]
