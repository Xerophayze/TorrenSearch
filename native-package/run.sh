#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$ROOT/app"
DATA_ROOT="$ROOT/data"
LOG_ROOT="$ROOT/logs"
VPN_CONF="$ROOT/vpn/airvpn.conf"
LAN_MODE=0

if [ "${1:-}" = "--lan" ]; then
  LAN_MODE=1
fi

mkdir -p "$DATA_ROOT" "$LOG_ROOT" "$ROOT/vpn"
if [ ! -f "$DATA_ROOT/settings.json" ]; then
  cp "$ROOT/settings.seed.json" "$DATA_ROOT/settings.json"
fi

if [ -f "$VPN_CONF" ]; then
  echo "==> Starting WireGuard tunnel from vpn/airvpn.conf"
  sudo cp "$VPN_CONF" /etc/wireguard/torrensearch-airvpn.conf
  sudo wg-quick up torrensearch-airvpn || true
else
  echo "WARNING: vpn/airvpn.conf not found. Continuing without starting VPN."
fi

echo "==> Starting Prowlarr"
sudo systemctl start prowlarr || true

echo "==> Starting qBittorrent-nox"
if ! pgrep -f "qbittorrent-nox.*8080" >/dev/null 2>&1; then
  nohup qbittorrent-nox --webui-port=8080 --confirm-legal-notice \
    > "$LOG_ROOT/qbittorrent.out.log" 2> "$LOG_ROOT/qbittorrent.err.log" &
  echo "$!" > "$DATA_ROOT/qbittorrent.pid"
fi

echo "==> Starting TorrenSearch"
if ! pgrep -f "node.*server.js" >/dev/null 2>&1; then
  HOST_VALUE="127.0.0.1"
  if [ "$LAN_MODE" -eq 1 ]; then
    HOST_VALUE="0.0.0.0"
  fi
  (
    cd "$APP_ROOT"
    HOST="$HOST_VALUE" \
    PORT=8787 \
    DATA_DIR="$DATA_ROOT" \
    PROWLARR_FALLBACK_URLS="http://127.0.0.1:9696,http://localhost:9696" \
    nohup node server.js > "$LOG_ROOT/torrensearch.out.log" 2> "$LOG_ROOT/torrensearch.err.log" &
    echo "$!" > "$DATA_ROOT/torrensearch.pid"
  )
fi

echo
echo "TorrenSearch native stack is starting."
echo "TorrenSearch: http://127.0.0.1:8787"
if [ "$LAN_MODE" -eq 1 ]; then
  echo "LAN mode is enabled. Try this computer's LAN IP on port 8787."
  if command -v hostname >/dev/null 2>&1; then
    hostname -I 2>/dev/null | tr ' ' '\n' | awk 'NF { print "  http://" $1 ":8787" }' || true
  fi
fi
echo "Prowlarr:     http://127.0.0.1:9696"
echo "qBittorrent:  http://127.0.0.1:8080"

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://127.0.0.1:8787" >/dev/null 2>&1 || true
fi
