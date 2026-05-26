#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# doctor.sh — sanity-check the local + tunnel setup. Run this whenever
# something feels wrong; it tells you which piece is broken.
#
#   npm run doctor
# ─────────────────────────────────────────────────────────────────────────────

set +e
cd "$(dirname "$0")/.."

OK() { printf "  \033[32m✓\033[0m  %s\n" "$1"; }
WARN() { printf "  \033[33m⚠\033[0m  %s\n" "$1"; }
FAIL() { printf "  \033[31m✗\033[0m  %s\n" "$1"; }

echo
echo "── Dependencies ─────────────────────────────────────────────────"
for cmd in node npm docker ngrok jq curl; do
  if command -v "$cmd" >/dev/null 2>&1; then
    OK "$cmd  →  $(command -v $cmd)"
  else
    FAIL "$cmd not installed"
  fi
done

echo
echo "── Docker services ──────────────────────────────────────────────"
if docker ps --format '{{.Names}}' | grep -q postgres; then
  OK "Postgres container running"
else
  FAIL "Postgres container NOT running — run: docker compose up -d"
fi
if docker ps --format '{{.Names}}' | grep -q redis; then
  OK "Redis container running"
else
  FAIL "Redis container NOT running — run: docker compose up -d"
fi

echo
echo "── App processes ────────────────────────────────────────────────"
if lsof -ti :4000 >/dev/null 2>&1; then
  OK "Backend API on :4000"
else
  FAIL "Backend NOT running — run: npm run dev:backend"
fi
if lsof -ti :3000 >/dev/null 2>&1; then
  OK "Frontend on :3000"
else
  FAIL "Frontend NOT running — run: npm run dev:frontend"
fi
if pgrep -f "workers/index" >/dev/null 2>&1; then
  OK "BullMQ workers running"
else
  WARN "Workers NOT running — run: npm run dev:workers"
fi

echo
echo "── Tunnel ───────────────────────────────────────────────────────"
if pgrep -x ngrok >/dev/null 2>&1; then
  TUNNEL_URL=$(curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null | jq -r '.tunnels[] | select(.proto=="https") | .public_url' 2>/dev/null | head -1)
  if [ -n "$TUNNEL_URL" ] && [ "$TUNNEL_URL" != "null" ]; then
    OK "ngrok up:  $TUNNEL_URL"
    # Verify the tunnel actually serves the app
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" -L "$TUNNEL_URL")
    if [ "$STATUS" = "200" ] || [ "$STATUS" = "307" ] || [ "$STATUS" = "302" ]; then
      OK "Tunnel responds with $STATUS — app reachable"
    else
      WARN "Tunnel responds $STATUS — check the frontend is up on :3000"
    fi
  else
    WARN "ngrok running but no public URL — check /tmp/leadforge-ngrok.log"
  fi
else
  WARN "ngrok NOT running — run: npm run tunnel"
fi

echo
echo "── Backend env sanity ───────────────────────────────────────────"
ENV_FILE="backend/.env"
if [ ! -f "$ENV_FILE" ]; then
  FAIL "backend/.env missing"
else
  for key in DATABASE_URL REDIS_URL CLERK_SECRET_KEY PUBLIC_URL PUBLIC_APP_URL CORS_ORIGIN; do
    if grep -q "^${key}=" "$ENV_FILE" && [ -n "$(grep "^${key}=" "$ENV_FILE" | cut -d= -f2-)" ]; then
      VAL=$(grep "^${key}=" "$ENV_FILE" | cut -d= -f2-)
      # Mask secrets
      if [[ "$key" == *KEY* || "$key" == *SECRET* || "$key" == *PASS* ]]; then
        VAL="${VAL:0:8}…"
      fi
      OK "$key = $VAL"
    else
      WARN "$key is empty or missing in $ENV_FILE"
    fi
  done
fi

echo
echo "── Endpoint reachability ────────────────────────────────────────"
if curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/health | grep -q 200; then
  OK "Backend /health responds 200"
else
  WARN "Backend /health unreachable"
fi
if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 | grep -qE "200|307|308"; then
  OK "Frontend / responds 2xx/3xx"
else
  WARN "Frontend unreachable"
fi

echo
echo "Done."
