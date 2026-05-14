# Self-hosting Infetch

The recommended self-hosting path is the bundled `docker-compose.yml`. This document covers what you should know before running it in production.

## Quick start

```bash
git clone https://github.com/olebm/infetch.git
cd infetch
cp .env.example .env
docker-compose up -d
```

Then open http://127.0.0.1:3000 in your browser. The first run kicks off the onboarding wizard.

## Credential storage

Infetch stores IMAP/SMTP/Portal credentials in a secure store. Two backends are supported:

| Environment | Backend | What to configure |
|-------------|---------|-------------------|
| macOS (local dev) | OS Keychain | Nothing — automatic |
| Linux / Docker (Hetzner, Coolify, VPS) | AES-256-GCM encrypted in SQLite | `SECRET_ENCRYPTION_KEY` in `.env` |

**Linux / Docker setup — required before configuring IMAP/SMTP:**

1. Generate a random 32-byte key:
   ```bash
   openssl rand -hex 32
   ```
2. Add it to `.env`:
   ```
   SECRET_ENCRYPTION_KEY=<output from above>
   ```
3. **Keep this key safe.** Back it up separately from the volume — losing it means you cannot decrypt stored credentials and will need to re-enter them.

The key is never stored in the database. Ciphertexts at rest are AES-256-GCM protected and tagged (tamper-evident).

## DSGVO / GDPR

Infetch stores invoices locally:

- PDF originals: `data/invoices/`
- Extracted metadata: `data/invoice-agent.db` (SQLite)
- Raw text from PDFs: `data/raw-text/`
- Browser sessions for portals: `data/sessions/`
- Logs: `data/logs/`

In Docker these are all under the `invoice-data` named volume. You — the operator — are the data controller. No data is uploaded to a third party except:

- **Mistral API** (if you enabled AI extraction): PDF text + metadata go to mistral.ai under your API key.
- **GitHub raw URL**: the daily community-sync job fetches public recipe JSON from `raw.githubusercontent.com`.
- **Your IMAP/SMTP servers**: invoice mail traffic.

If you need a stricter setup, disable AI extraction in `/einstellungen` and override `COMMUNITY_RECIPES_REPO` to a private mirror.

## Backups

The entire app state is in the `invoice-data` Docker volume.

```bash
# Backup
docker run --rm \
  -v invoice-agent-data:/data \
  -v $(pwd):/backup \
  alpine \
  tar czf /backup/invoice-agent-backup.tar.gz -C /data .

# Restore (only into an empty volume)
docker run --rm \
  -v invoice-agent-data:/data \
  -v $(pwd):/backup \
  alpine \
  sh -c "cd /data && tar xzf /backup/invoice-agent-backup.tar.gz"
```

The SQLite database uses WAL mode by default. Backing up the volume while the app is running can capture an inconsistent snapshot — stop the container before backing up, or use `sqlite3 .backup` semantics.

## Upgrading

```bash
git pull
docker-compose build
docker-compose up -d
```

The container runs `npm run db:init` on every start. Migrations are idempotent and forward-only.

## Logs

```bash
docker-compose logs -f invoice-agent
```

Or `docker exec -it invoice-agent ls /app/data/logs` for on-disk logs.

## Resource expectations

- Idle: ~250–400 MB RAM (Node + SQLite cache)
- Portal-agent active (Chromium spawned): up to ~1 GB RAM
- Disk: ~1.5 GB for the image, plus your invoices (typically a few hundred MB/year)

## Reverse proxy

Not currently supported out of the box. If you proxy via Caddy/nginx/Traefik:

- Terminate TLS at the proxy.
- Forward to `127.0.0.1:3000`.
- The app does **not** enforce auth — anyone reaching the port gets access. Use the proxy to add basic auth, mTLS, or an OIDC layer.

The DSGVO-safe default is to leave the bind at `127.0.0.1` and access via SSH tunnel.

## What is not in the image

- Mail submission: relies on your external SMTP server.
- Backup automation: bring your own cron / restic / borg.
- TLS certificates: terminate at a reverse proxy.
- Multi-user separation: Infetch is single-user. Run a separate compose stack per user if needed.
