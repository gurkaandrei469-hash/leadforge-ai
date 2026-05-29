#!/bin/sh
# BullMQ worker entrypoint. Migrations are normally applied by the API container
# but we re-attempt them here (idempotent — `prisma migrate deploy` is a no-op
# when there's nothing pending) so the workers can boot first on a cold deploy
# without crashing on a schema mismatch.
set -e
npx prisma migrate deploy || true
echo "→ Starting BullMQ workers"
exec node dist/workers/index.js
