#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# tunnel-cf.sh — expose LeadForge AI on a public HTTPS URL via Cloudflare Tunnel.
# Zero-signup alternative to ngrok. Uses cloudflared's "quick tunnel" feature,
# which gives you a free https://*.trycloudflare.com URL with no auth.
#
# Usage:
#   chmod +x scripts/tunnel-cf.sh
#   ./scripts/tunnel-cf.sh
#
# Limitations of the quick-tunnel URL:
#   - URL changes every time you restart (no persistence)
#   - For a stable URL, set up a named tunnel with your own Cloudflare account
# ─────────────────────────────────────────────────────────────────────────────

set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "❌ cloudflared not installed. Install with:"
  echo "    brew install cloudflared"
  exit 1
fi

# Kill any leftover cloudflared
if pgrep -x cloudflared >/dev/null; then
  echo "⚠️  Killing existing cloudflared…"
  pkill -x cloudflared || true
  sleep 1
fi

LOG=/tmp/leadforge-cf.log
echo "🚀 Starting Cloudflare Tunnel on :$FRONTEND_PORT…"
cloudflared tunnel --url "http://localhost:$FRONTEND_PORT" --no-autoupdate > "$LOG" 2>&1 &
CF_PID=$!

# Wait for the URL to appear in the log (cloudflared prints it ~5s after start)
echo "⏳ Waiting for tunnel…"
PUBLIC_URL=""
for i in $(seq 1 30); do
  PUBLIC_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" 2>/dev/null | head -1)
  if [ -n "$PUBLIC_URL" ]; then break; fi
  sleep 1
done

if [ -z "$PUBLIC_URL" ]; then
  echo "❌ Couldn't get the Cloudflare tunnel URL. Log:"
  tail -30 "$LOG"
  kill $CF_PID 2>/dev/null || true
  exit 1
fi

echo "✅ Tunnel up: $PUBLIC_URL"
echo

# ─── Patch env files (same logic as tunnel.sh) ──────────────────────────────
patch_env() {
  local file="$1" key="$2" value="$3"
  if [ ! -f "$file" ]; then echo "$key=$value" > "$file"; return; fi
  if grep -q "^${key}=" "$file"; then
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
patch_env "$ROOT/backend/.env" "CORS_ORIGIN"               "http://localhost:3000,${PUBLIC_URL},https://*.trycloudflare.com,https://*.ngrok-free.app"

echo
echo "═══════════════════════════════════════════════════════════════════════"
echo "🌐  Public URL:  $PUBLIC_URL"
echo "═══════════════════════════════════════════════════════════════════════"
echo
echo "⚠️  ACTION REQUIRED — Google Cloud Console (for Gmail OAuth from remote):"
echo
echo "   1. Go to https://console.cloud.google.com/auth/clients"
echo "   2. Edit your OAuth client (LEADFORGE)"
echo "   3. Authorized JavaScript origins:  $PUBLIC_URL"
echo "   4. Authorized redirect URIs:       $REDIRECT_URI"
echo "   5. Save"
echo
echo "🔄 Restart the backend so it picks up the new env vars:"
echo "        cd backend && npm run dev"
echo
echo "📜 cloudflared log:  $LOG"
echo
echo "Press Ctrl-C to tear down the tunnel."
echo

trap 'echo; echo "🛑 Tearing down tunnel…"; kill $CF_PID 2>/dev/null; exit 0' INT TERM
wait $CF_PID
