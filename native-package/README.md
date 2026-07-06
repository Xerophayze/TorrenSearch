# TorrenSearch Native Package

This package runs TorrenSearch without Docker Desktop.

It installs/uses normal native applications:

- Node.js LTS for the TorrenSearch backend
- qBittorrent or qBittorrent-nox for downloads
- Prowlarr for torrent indexer/search management
- WireGuard for the optional AirVPN tunnel

## Why This Exists

Docker Desktop is heavy on Windows and can require virtualization, background services, and sign-in prompts. This package avoids Docker entirely. The tradeoff is that native apps have their own first-run setup screens and service behavior, so this package can start them but cannot control every installer-owned setting as cleanly as Docker Compose can.

## Windows Quick Start

Run:

```text
setup.bat
run.bat
```

After `setup.bat` finishes, it opens `NEXT_STEPS.txt` with the configuration checklist.

`setup.bat` installs these packages with `winget`:

- `OpenJS.NodeJS.LTS`
- `qBittorrent.qBittorrent`
- `TeamProwlarr.Prowlarr`
- `WireGuard.WireGuard`

No Docker Desktop is installed or used.

Optional VPN:

1. Export/download an AirVPN WireGuard config file.
2. Put it in `vpn\` with a `.conf` extension.
3. Run `run.bat`.

If a WireGuard config exists, `run.bat` will try to install/start it as a WireGuard tunnel service. Windows may ask for administrator approval.

For access from phones or other computers on the same network, use:

```text
run-lan.bat
```

If Windows Firewall asks, allow access on Private networks.

## Linux Quick Start

Debian/Ubuntu-style systems:

```sh
chmod +x setup.sh run.sh stop.sh
./setup.sh
./run.sh
```

For LAN mode:

```sh
./run-lan.sh
```

Optional VPN:

```text
vpn/airvpn.conf
```

The Linux setup script installs native packages with `apt-get`, installs Prowlarr into `/opt/Prowlarr`, and creates a `prowlarr` systemd service. The Prowlarr Linux install flow follows the upstream Prowlarr/Servarr guidance that Prowlarr is installed under `/opt` and stores config under `/var/lib/prowlarr`.

## URLs

After `run`:

| Service | URL |
| --- | --- |
| TorrenSearch | `http://127.0.0.1:8787` |
| Prowlarr | `http://127.0.0.1:9696` |
| qBittorrent | `http://127.0.0.1:8080` |

## First-Time Configuration

`NEXT_STEPS.txt` contains the full ordered checklist. Short version:

TorrenSearch is seeded with:

```text
Prowlarr URL: http://127.0.0.1:9696
qBittorrent URL: http://127.0.0.1:8080
```

You still need to:

1. Open qBittorrent, enable Web UI on port `8080`, and set username/password.
2. Open Prowlarr, add indexers, and copy the API key from Settings > General > Security.
3. Open TorrenSearch Settings and paste the qBittorrent and Prowlarr credentials.
4. Configure VPN if desired.
5. Use `run-lan.bat` or `run-lan.sh` if other devices on the local network need access.

## Folder Layout

```text
native-package/
  app/                  TorrenSearch index.html and server.js
  data/                 TorrenSearch settings and pid files
  logs/                 TorrenSearch/qBittorrent logs
  vpn/                  Optional AirVPN WireGuard .conf files
  setup.*               Native setup scripts
  run.*                 Native start scripts
  run-lan.*             Start scripts for local network access
  stop.*                Stop TorrenSearch backend
  NEXT_STEPS.txt        Opens after setup with configuration instructions
```

## Notes

- This package does not install or use Docker.
- Native WireGuard usually routes the whole machine through the VPN unless the config is customized for split tunneling.
- For best privacy, start the VPN before searching/downloading.
- Prefer VPN-based remote access. Avoid exposing qBittorrent or Prowlarr directly to the public internet.
- Use TorrenSearch only for torrents and content you are legally allowed to access.
