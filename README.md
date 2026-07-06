<img width="2472" height="1584" alt="chrome_ahHWKgsp3M" src="https://github.com/user-attachments/assets/ef434390-1c93-47f8-8927-a7a7a71d0fe6" />
# TorrenSearch

TorrenSearch is a self-hosted torrent search and qBittorrent management UI. It provides a browser front end plus a small Node.js backend that can search public torrent APIs, query Prowlarr, send results to qBittorrent, and monitor slow torrents.

The project supports three deployment styles:

| Path | Purpose |
| --- | --- |
| `synology/` | Synology Container Manager / Docker install files and instructions |
| `native-package/` | No-Docker Windows/Linux native setup scripts |
| `scripts/local/` | Developer/local convenience launchers |

## Features

- Unified torrent search UI
- Prowlarr integration with selectable indexers
- qBittorrent Web API integration
- add torrents directly from search results
- start, stop, force resume, reannounce, recheck, delete, and inspect qBittorrent torrents
- configurable result filters, including content type, seeders, leechers, and minimum size
- `ngosang/trackerslist` refresh button for public tracker presets
- slow torrent monitor with optional tracker refresh and Prowlarr alternative search
- Synology-friendly Docker deployment
- no-Docker native package for Windows/Linux

## Repository Layout

```text
.
  index.html                 Browser UI
  server.js                  Node.js backend
  Dockerfile                 Minimal image for TorrenSearch-only deployments
  docker-compose.yml         Basic Synology TorrenSearch-only compose file
  docker-compose.prowlarr.yml Local development Prowlarr helper
  synology/                  Synology install docs and sanitized compose examples
  native-package/            Native Windows/Linux package without Docker Desktop
  scripts/local/             Local developer launch scripts
```

Generated runtime folders such as `.data/`, `native-package/data/`, `native-package/logs/`, VPN configs, `.env`, and Synology container data are intentionally ignored by Git.

## Synology Install

Start here:

[Synology Installation](synology/README.md)

Short version:

1. Install **Container Manager** on Synology.
2. Create:

   ```text
   /volume2/docker/torrensearch
   /volume2/docker/torrensearch-data
   ```

3. Copy the app files into `/volume2/docker/torrensearch`:

   ```text
   index.html
   server.js
   Dockerfile
   docker-compose.yml
   README.md
   ```

4. Create a Container Manager project from `/volume2/docker/torrensearch`.
5. Open:

   ```text
   http://<synology-ip>:8787
   ```

For the full AirVPN/Gluetun/qBittorrent/Prowlarr stack, use:

[synology/docker-compose.full-airvpn.example.yml](synology/docker-compose.full-airvpn.example.yml)

Copy `synology/.env.example` to `.env` on the NAS and fill in your own AirVPN WireGuard values. Never commit the real `.env`.

## Native No-Docker Install

Use this if you do not want Docker Desktop:

[native-package/README.md](native-package/README.md)

Windows:

```text
native-package\setup.bat
native-package\run.bat
```

Linux:

```sh
cd native-package
chmod +x setup.sh run.sh stop.sh
./setup.sh
./run.sh
```

## Local Development

TorrenSearch only:

```powershell
.\scripts\local\Start-TorrenSearch.ps1
```

TorrenSearch plus a local Prowlarr helper container:

```powershell
.\scripts\local\Start-TorrenSearch-Full.ps1 -Lan
```

Direct Node run:

```powershell
node .\server.js
```

Then open:

```text
http://127.0.0.1:8787
```

## First-Time App Settings

For the full Synology VPN stack, TorrenSearch, Prowlarr, and qBittorrent share the same Gluetun network namespace. Use:

```text
Prowlarr URL: http://127.0.0.1:9696
qBittorrent URL: http://127.0.0.1:8080
```

Then paste:

- Prowlarr API key from Prowlarr Settings > General > Security
- qBittorrent WebUI username/password or API token

## Security

Do not commit:

- real `.env` files
- `settings.json`
- Prowlarr config/database/logs
- qBittorrent config
- Gluetun config/state
- WireGuard private or preshared keys
- qBittorrent or Prowlarr API keys

Keep TorrenSearch private to your LAN or VPN. If you expose it outside trusted networks, configure `PROXY_TOKEN` and `ALLOWED_PROXY_HOSTS`.

Use TorrenSearch only for torrents and content you are legally allowed to access.
