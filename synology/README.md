# Synology Installation

This folder contains sanitized Docker Compose examples for installing TorrenSearch on a Synology NAS with Container Manager.

Use the live NAS path only as a reference. Do not copy runtime folders such as Prowlarr databases, qBittorrent config, Gluetun server cache, logs, or settings files into GitHub.

## Required Synology Package

Install **Container Manager** from Synology Package Center.

## Option A: TorrenSearch Only

Use this when Prowlarr/qBittorrent/VPN already exist somewhere else.

1. Create these NAS folders:

   ```text
   /volume2/docker/torrensearch
   /volume2/docker/torrensearch-data
   ```

2. Copy these project files into `/volume2/docker/torrensearch`:

   ```text
   index.html
   server.js
   Dockerfile
   docker-compose.yml
   README.md
   ```

3. In Container Manager, create a project:

   ```text
   Project name: torrensearch
   Project path: /volume2/docker/torrensearch
   Compose file: docker-compose.yml
   ```

4. Start the project.

5. Open:

   ```text
   http://<synology-ip>:8787
   ```

## Option B: Full AirVPN Stack

Use this when Synology should run all of:

- Gluetun/AirVPN
- qBittorrent
- Prowlarr
- TorrenSearch

1. Create these NAS folders:

   ```text
   /volume2/docker/torrensearch
   /volume2/docker/torrensearch-data
   /volume2/docker/torrent-vpn/gluetun
   /volume2/docker/torrent-vpn/qbittorrent
   /volume2/docker/torrent-vpn/prowlarr
   ```

2. Copy the app files into `/volume2/docker/torrensearch`:

   ```text
   index.html
   server.js
   README.md
   ```

3. Copy `synology/docker-compose.full-airvpn.example.yml` and `synology/.env.example` into your Container Manager project folder, such as:

   ```text
   /volume2/docker/torrent-vpn
   ```

4. Rename the files:

   ```text
   docker-compose.full-airvpn.example.yml -> compose.yaml
   .env.example -> .env
   ```

5. Edit `.env` and fill in your own AirVPN WireGuard values.

6. In Container Manager, create/start the project from `/volume2/docker/torrent-vpn`.

7. Open:

   ```text
   TorrenSearch: http://<synology-ip>:8787
   qBittorrent:  http://<synology-ip>:8080
   Prowlarr:     http://<synology-ip>:9696
   ```

## First-Time TorrenSearch Settings

Inside TorrenSearch, set:

```text
Prowlarr URL: http://127.0.0.1:9696
qBittorrent URL: http://127.0.0.1:8080
```

Those localhost URLs work in the full stack because TorrenSearch, Prowlarr, and qBittorrent share Gluetun's network namespace.

Then paste:

- Prowlarr API key from Prowlarr Settings > General > Security
- qBittorrent WebUI username/password or API token

## What Not To Commit

Never commit:

- `.env`
- `/volume2/docker/torrensearch-data`
- Prowlarr `config.xml`, database files, logs, backups, or API keys
- qBittorrent config files
- Gluetun config/state folders
- WireGuard private keys or preshared keys
- any real `settings.json`

## Updating TorrenSearch

For UI/backend updates, replace these files in `/volume2/docker/torrensearch`:

```text
index.html
server.js
README.md
```

Restart the `torrensearch` container after changing `server.js`.
