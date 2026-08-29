#!/usr/bin/env bash
# Public HTTPS URL for the phone (passkeys need a secure context + a real hostname).
# Writes the URL to .data/public-url.txt so the app can hand it to agents and QR codes.
set -euo pipefail
PORT="${PORT:-3210}"
mkdir -p .data
rm -f .data/public-url.txt
echo "Starting cloudflared tunnel → http://localhost:$PORT"
cloudflared tunnel --url "http://localhost:$PORT" --no-autoupdate 2>&1 | while IFS= read -r line; do
  if [[ "$line" =~ (https://[a-z0-9-]+\.trycloudflare\.com) ]]; then
    echo "${BASH_REMATCH[1]}" > .data/public-url.txt
    echo ""
    echo "  Public URL: ${BASH_REMATCH[1]}"
    echo "  Phone inbox: ${BASH_REMATCH[1]}/m"
    echo ""
  fi
done
