#!/bin/sh
# Production API entrypoint. Runs Prisma migrations idempotently, then
# starts the Express server. Copied into the Docker image at /app/start-api.sh
# and invoked via tini as PID 1 so SIGTERM forwarding works on Railway redeploys.
set -e

echo "→ Applying database migrations…"
# Retry up to 5 times with back-off — handles Neon cold-start latency
# where the compute wakes up 1-3 s after the first connection attempt.
ATTEMPT=0
until npx prisma migrate deploy; do
  ATTEMPT=$((ATTEMPT + 1))
  if [ "$ATTEMPT" -ge 5 ]; then
    echo "Migration failed after $ATTEMPT attempts — aborting"
    exit 1
  fi
  echo "Migration attempt $ATTEMPT failed, retrying in 5s…"
  sleep 5
done

echo "→ Starting API server"
exec node dist/server.js
