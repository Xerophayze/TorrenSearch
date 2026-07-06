#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

step() {
  echo
  echo "==> $1"
}

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This native setup.sh currently supports Debian/Ubuntu-style systems with apt-get."
  echo "Install Node.js, qBittorrent, Prowlarr, and WireGuard manually for this distro, then use run.sh."
  exit 1
fi

step "Preparing native TorrenSearch folders"
mkdir -p data logs vpn
if [ ! -f data/settings.json ]; then
  cp settings.seed.json data/settings.json
fi

step "Installing native dependencies"
sudo apt-get update
sudo apt-get install -y curl ca-certificates sqlite3 nodejs npm qbittorrent-nox wireguard-tools

if [ ! -x /opt/Prowlarr/Prowlarr ]; then
  step "Installing Prowlarr"
  sudo useradd --system --home /var/lib/prowlarr --shell /usr/sbin/nologin prowlarr 2>/dev/null || true
  sudo mkdir -p /var/lib/prowlarr /opt
  tmpdir="$(mktemp -d)"
  curl -L -o "$tmpdir/prowlarr.tar.gz" "https://prowlarr.servarr.com/v1/update/master/updatefile?os=linux&runtime=netcore&arch=x64"
  tar -xzf "$tmpdir/prowlarr.tar.gz" -C "$tmpdir"
  sudo rm -rf /opt/Prowlarr
  sudo mv "$tmpdir/Prowlarr" /opt/Prowlarr
  sudo chown -R prowlarr:prowlarr /opt/Prowlarr /var/lib/prowlarr
  rm -rf "$tmpdir"

  sudo tee /etc/systemd/system/prowlarr.service >/dev/null <<'SERVICE'
[Unit]
Description=Prowlarr Daemon
After=network.target

[Service]
User=prowlarr
Group=prowlarr
Type=simple
ExecStart=/opt/Prowlarr/Prowlarr -nobrowser -data=/var/lib/prowlarr
TimeoutStopSec=20
KillMode=process
Restart=on-failure

[Install]
WantedBy=multi-user.target
SERVICE

  sudo systemctl daemon-reload
  sudo systemctl enable prowlarr
fi

step "Setup complete"
echo "Opening next-step instructions if a desktop text viewer is available."
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$ROOT/NEXT_STEPS.txt" >/dev/null 2>&1 || true
fi
echo "Read NEXT_STEPS.txt, then run ./run.sh or ./run-lan.sh."
