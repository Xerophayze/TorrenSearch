#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_ROOT="$ROOT/data"

if [ -f "$DATA_ROOT/torrensearch.pid" ]; then
  kill "$(cat "$DATA_ROOT/torrensearch.pid")" 2>/dev/null || true
  rm -f "$DATA_ROOT/torrensearch.pid"
fi

if [ -f "$DATA_ROOT/qbittorrent.pid" ]; then
  kill "$(cat "$DATA_ROOT/qbittorrent.pid")" 2>/dev/null || true
  rm -f "$DATA_ROOT/qbittorrent.pid"
fi

echo "Stopped TorrenSearch and qBittorrent-nox if they were started by this package."
echo "Prowlarr and WireGuard may still be running as system services."
