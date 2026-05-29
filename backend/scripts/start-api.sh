#!/bin/sh
# Production API entrypoint. Runs Prisma migrations idempotently, then
# starts the Express server. Copied into the Docker image at /app/start-api.sh
# and invoked via tini as PID 1 so SIGTERM forwarding works on Railway redeploys.
set -e
echo "→ Applying database migrations…"
npx prisma migrate deploy
echo "→ Starting API server"
exec node dist/server.js
