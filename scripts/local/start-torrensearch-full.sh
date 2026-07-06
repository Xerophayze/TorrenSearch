#!/usr/bin/env sh
set -eu

SCRIPT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT="$(CDPATH= cd -- "$SCRIPT_ROOT/../.." && pwd)"
PORT="${PORT:-8787}"
HOST="${HOST:-0.0.0.0}"
DATA_ROOT="$ROOT/.data"
TORRENSEARCH_DATA="$DATA_ROOT/torrensearch"
PROWLARR_CONFIG="$DATA_ROOT/prowlarr"
COMPOSE_FILE="$ROOT/docker-compose.prowlarr.yml"

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

docker_compose() {
  if command_exists docker && docker compose version >/dev/null 2>&1; then
    docker compose -f "$COMPOSE_FILE" "$@"
  elif command_exists docker-compose; then
    docker-compose -f "$COMPOSE_FILE" "$@"
  else
    echo "Docker Compose was not found. Install Docker, or run node server.js for TorrenSearch only." >&2
    exit 1
  fi
}

get_api_key() {
  if [ ! -f "$PROWLARR_CONFIG/config.xml" ]; then
    return 0
  fi
  sed -n 's:.*<ApiKey>\\(.*\\)</ApiKey>.*:\\1:p' "$PROWLARR_CONFIG/config.xml" | head -n 1
}

write_settings() {
  api_key="$1"
  [ -n "$api_key" ] || return 0
  mkdir -p "$TORRENSEARCH_DATA"
  cat > "$TORRENSEARCH_DATA/settings.json" <<EOF
{
  "mode": "backend",
  "sort": "seeders",
  "sortDirection": "desc",
  "proxyTemplate": "/proxy?url={url}",
  "prowlarrUrl": "http://127.0.0.1:9696",
  "prowlarrKey": "$api_key",
  "enabledProviders": {
    "prowlarr": true
  }
}
EOF
}

if ! command_exists node; then
  echo "Node.js was not found in PATH. Install Node.js 20+ or 22+." >&2
  exit 1
fi

mkdir -p "$TORRENSEARCH_DATA" "$PROWLARR_CONFIG"
cd "$ROOT"

echo "Starting local Prowlarr with Docker Compose..."
docker_compose up -d

api_key=""
i=0
while [ "$i" -lt 60 ]; do
  api_key="$(get_api_key || true)"
  [ -n "$api_key" ] && break
  i=$((i + 1))
  sleep 2
done

if [ -n "$api_key" ]; then
  write_settings "$api_key"
  echo "Prowlarr API key found and saved to TorrenSearch backend settings."
else
  echo "Prowlarr started, but its API key was not available yet. Open http://127.0.0.1:9696 once, then restart this launcher." >&2
fi

echo "TorrenSearch: http://127.0.0.1:$PORT"
echo "Prowlarr:     http://127.0.0.1:9696"
echo "Press Ctrl+C to stop TorrenSearch. Prowlarr keeps running in Docker."

export HOST PORT
export DATA_DIR="$TORRENSEARCH_DATA"
export PROWLARR_FALLBACK_URLS="http://127.0.0.1:9696,http://localhost:9696"

node "$ROOT/server.js"
