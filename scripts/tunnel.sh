#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# tunnel.sh — expose LeadForge AI on a public HTTPS URL via ngrok.
#
# Single-tunnel architecture: ngrok forwards to the Next.js frontend (port 3000),
# Next.js rewrites /api/backend/* to the backend on localhost:4000. One public URL
# handles both UI and API. Google OAuth callbacks route through the same domain
# via Next.js rewrites — no separate backend tunnel needed.
#
# Usage:
#   chmod +x scripts/tunnel.sh
#   ./scripts/tunnel.sh
#
# Optional env vars:
#   NGROK_AUTHTOKEN     — your ngrok auth token (https://dashboard.ngrok.com)
#   NGROK_DOMAIN        — reserve a custom subdomain (paid plan only)
#   FRONTEND_PORT       — defaults to 3000
# ─────────────────────────────────────────────────────────────────────────────

set -e

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

# ─── Dependency checks ─────────────────────────────────────────────────────
if ! command -v ngrok >/dev/null 2>&1; then
  echo "❌ ngrok is not installed."
  echo
  echo "Install it with Homebrew:"
  echo "    brew install ngrok"
  echo
  echo "Then sign up at https://dashboard.ngrok.com and grab your auth token."
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "❌ jq is required to parse the ngrok API response."
  echo "    brew install jq"
  exit 1
fi

# ─── Auth token (one-time setup) ───────────────────────────────────────────
if [ -n "$NGROK_AUTHTOKEN" ]; then
  ngrok config add-authtoken "$NGROK_AUTHTOKEN" >/dev/null
fi

# ─── Kill any leftover ngrok process ───────────────────────────────────────
if pgrep -x "ngrok" >/dev/null; then
  echo "⚠️  Killing existing ngrok process…"
  pkill -x ngrok || true
  sleep 1
fi

# ─── Start ngrok tunnel ────────────────────────────────────────────────────
echo "🚀 Starting ngrok tunnel on :$FRONTEND_PORT…"
if [ -n "$NGROK_DOMAIN" ]; then
  ngrok http "$FRONTEND_PORT" --domain="$NGROK_DOMAIN" --log=stdout > /tmp/leadforge-ngrok.log 2>&1 &
else
  ngrok http "$FRONTEND_PORT" --log=stdout > /tmp/leadforge-ngrok.log 2>&1 &
fi
NGROK_PID=$!

# Wait for the local ngrok API to come up
echo "⏳ Waiting for tunnel…"
for i in $(seq 1 30); do
  if curl -s http://127.0.0.1:4040/api/tunnels >/dev/null 2>&1; then break; fi
  sleep 0.5
done

# Pull the public HTTPS URL out of ngrok's local API
PUBLIC_URL=$(curl -s http://127.0.0.1:4040/api/tunnels | jq -r '.tunnels[] | select(.proto=="https") | .public_url' | head -1)

if [ -z "$PUBLIC_URL" ] || [ "$PUBLIC_URL" = "null" ]; then
  echo "❌ Couldn't read the ngrok URL. Check /tmp/leadforge-ngrok.log for details."
  echo "   Most common cause: missing auth token. Run:"
  echo "       ngrok config add-authtoken <YOUR_TOKEN>"
  kill $NGROK_PID 2>/dev/null || true
  exit 1
fi

echo "✅ Tunnel up: $PUBLIC_URL"
echo

# ─── Patch the env files ───────────────────────────────────────────────────
patch_env() {
  local file="$1" key="$2" value="$3"
  if [ ! -f "$file" ]; then
    echo "$key=$value" > "$file"
    return
  fi
  if grep -q "^${key}=" "$file"; then
    # cross-platform sed in-place (works on macOS + Linux)
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s|^${key}=.*|${key}=${value}|" "$file"
    else
      sed -i "s|^${key}=.*|${key}=${value}|" "$file"
    fi
  else
    echo "$key=$value" >> "$file"
  fi
}

REDIRECT_URI="${PUBLIC_URL}/api/backend/sending-accounts/gmail/callback"

echo "📝 Updating backend/.env…"
patch_env "$ROOT/backend/.env" "PUBLIC_URL"                "$PUBLIC_URL"
patch_env "$ROOT/backend/.env" "PUBLIC_APP_URL"            "$PUBLIC_URL"
patch_env "$ROOT/backend/.env" "GOOGLE_OAUTH_REDIRECT_URI" "$REDIRECT_URI"
patch_env "$ROOT/backend/.env" "CORS_ORIGIN"               "http://localhost:3000,${PUBLIC_URL},https://*.ngrok-free.app,https://*.ngrok.io,https://*.trycloudflare.com"

echo "📝 Updating frontend/.env.local…"
# Frontend keeps NEXT_PUBLIC_API_URL pointing at localhost — the Next.js rewrites are
# applied SERVER-SIDE so the browser never sees this URL. Don't change it.
# (We just touch the file to confirm it exists.)
touch "$ROOT/frontend/.env.local"

echo
echo "═══════════════════════════════════════════════════════════════════════"
echo "🌐  Public URL:  $PUBLIC_URL"
echo "═══════════════════════════════════════════════════════════════════════"
echo
echo "⚠️  ACTION REQUIRED — Google Cloud Console:"
echo
echo "   1. Go to https://console.cloud.google.com/auth/clients"
echo "   2. Edit your OAuth client (LEADFORGE)"
echo "   3. Set Authorized JavaScript origins to:"
echo "        $PUBLIC_URL"
echo "   4. Set Authorized redirect URIs to:"
echo "        $REDIRECT_URI"
echo "   5. Save"
echo
echo "🔄 Restart the backend so it picks up the new env vars:"
echo "        cd backend && npm run dev"
echo
echo "🔄 Restart the frontend if Clerk session leaks the old origin:"
echo "        cd frontend && npm run dev"
echo
echo "📊 ngrok inspector (live request log):  http://127.0.0.1:4040"
echo "📜 ngrok process log:                   /tmp/leadforge-ngrok.log"
echo
echo "Press Ctrl-C to tear down the tunnel."
echo

# Keep the script alive so Ctrl-C cleanly kills ngrok
trap 'echo; echo "🛑 Tearing down tunnel…"; kill $NGROK_PID 2>/dev/null; exit 0' INT TERM
wait $NGROK_PID
