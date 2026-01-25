<p align="center">
  <img src="./public/maia.svg" alt="Maia" width="96" />
</p>

<p align="center">
  <a href="./README.md"><b>English</b></a> | <a href="./README.zh-cn.md">中文</a>
</p>

# Maia

Maia is a **self-hosted DAG workflow orchestration and execution service** built for long-running automation you can observe, debug, and replay execution history.

- **Durable**: SQLite-backed persistence with retained run state, logs, and outputs
- **Observable**: real-time SSE logs/events, plus history playback for past runs
- **Isolated execution**: a dedicated Runner executes each run inside a sandbox container, recommended for production
- **Composable**: each step has explicit inputs/outputs and produces artifacts
- **Optional Agent**: assists workflow authoring when enabled

![Runs preview](.github/assets/runs-preview-1.png)

## Quick start (Docker, self-host)

Docker deployment includes two services:

- **App (control plane)**: UI, scheduler/state machine, SQLite, SSE event stream
- **Runner (execution plane)**: starts/tears down sandbox containers and streams stdout/stderr back to the App

Default port: `3690` (open `http://localhost:3690`).

1) Download deployment files:

```bash
curl -fsSL -o docker-compose.release.yml https://raw.githubusercontent.com/obiscr/maia/main/docker-compose.release.yml
curl -fsSL -o .env.production https://raw.githubusercontent.com/obiscr/maia/main/env.example
```

2) Edit `.env.production` (minimum required):

- `RUNNER_TOKEN=...` (must match between App and Runner)

Recommended for production:

- `SETTINGS_ENCRYPTION_KEY=...` (secrets-at-rest; keep it stable and backed up)

3) Start:

```bash
docker compose -f docker-compose.release.yml --env-file .env.production up -d
```

4) Setup
Open [http://localhost:3690](http://localhost:3690) to start setup.

### Build from source (optional)

```bash
git clone https://github.com/obiscr/maia.git
cd maia
cp env.example .env.production
```

Set `RUNNER_TOKEN` in `.env.production`, then:

```bash
docker compose --env-file .env.production up -d --build
```

### Where is data stored?

The instance data directory inside the container is fixed at `/app/maia-data`, including:

- `db.sqlite` (database)
- `runs/...` (run outputs/logs/inputs)
- `workflows/...` (dependency snapshots)

By default Maia uses a Docker named volume (recommended). If you prefer a host bind mount, set in your env file:

- `MAIA_DATA_MOUNT_TYPE=bind`
- `MAIA_HOST_DATA_DIR=/absolute/path/on/host`

Then restart:

```bash
# Docker Hub deployment (docker-compose.release.yml)
docker compose -f docker-compose.release.yml --env-file .env.production up -d

# Source build (docker-compose.yml)
docker compose --env-file .env.production up -d --build
```

## Releases

- Changelog: `CHANGELOG.md`

## Operations (Docker)

The commands below assume `docker-compose.release.yml`. If you deployed from source, use the corresponding compose file (usually `docker-compose.yml`) and add `--build` as needed.

Upgrade (keeps data):

```bash
docker compose -f docker-compose.release.yml --env-file .env.production pull
docker compose -f docker-compose.release.yml --env-file .env.production up -d --remove-orphans
```

Logs:

```bash
docker compose -f docker-compose.release.yml logs -f maia
docker compose -f docker-compose.release.yml logs -f runner
```

Uninstall and delete ALL data (dangerous):

```bash
docker compose -f docker-compose.release.yml down -v
```

## Troubleshooting

- **`RUNNER_TOKEN_MISSING / UNAUTHORIZED`**: ensure `RUNNER_TOKEN` is set and identical for App and Runner
- **`image not found: maia-sandbox` / `No such image: maia-sandbox:latest`**:
  - if you want a local/offline image: run `docker build -f Dockerfile.sandbox -t maia-sandbox .` and set `MAIA_SANDBOX_IMAGE=maia-sandbox`
  - otherwise: set `MAIA_SANDBOX_IMAGE=obiscr/maia-sandbox:latest` (or upgrade your `docker-compose.release.yml`/`docker-compose.yml`) so Docker can auto-pull it
- **Bind mount write failures (Linux / EACCES)**: ensure the host dir is writable (Runner writes as `65532:65532`), e.g. `sudo chown -R 65532:65532 <MAIA_HOST_DATA_DIR>`

## Local development (contributors)

For UI/logic development, steps can run as child processes in the App process (no container isolation).

Prerequisites: Node.js 20+, pnpm (via Corepack), Git.

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

To enable the Runner or configure production-grade settings (e.g. crypto keys), use `env.example` and create `.env.local`:

```bash
cp env.example .env.local
```

## Project links

- Contributing: `CONTRIBUTING.md`
- Security: `SECURITY.md`
- Code of Conduct: `CODE_OF_CONDUCT.md`
- Codebase conventions: `docs/CODEBASE_CONVENTIONS.md`

## Credits

- Color palette inspiration and some CSS references: **Starlight** (MIT): `https://github.com/withastro/starlight`
- UI component design (in part) inspiration: **GitHub Actions**: `https://github.com/features/actions`
- Third-party notices: `THIRD_PARTY_NOTICES.md`

## License

MIT (see `LICENSE`).
