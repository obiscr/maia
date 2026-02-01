<p align="center">
  <img src="./public/maia.svg" alt="Maia" width="96" />
</p>

<p align="center">
  <a href="./README.md"><b>English</b></a> | <a href="./README.zh-cn.md">中文</a>
</p>

<p align="center">
  <a href="https://hub.docker.com/r/obiscr/maia">
    <img src="https://img.shields.io/docker/pulls/obiscr/maia" alt="Docker Pulls" />
  </a>
  
  <a href="https://hub.docker.com/r/obiscr/maia">
    <img src="https://img.shields.io/docker/v/obiscr/maia" alt="Docker Image Version" />
  </a>
</p>

# Maia

Maia is a self-hosted DAG workflow orchestration and execution service for long-running automation—observable, debuggable, and replayable.

- **Persistence**: state and outputs are persisted with SQLite (retained and traceable)
- **Observability**: real-time logs/event streams (SSE) with replay
- **Isolated execution**: optional Runner + Sandbox container isolation (recommended for production)
- **Composable**: each step has explicit inputs/outputs and can produce artifacts
- **Optional agent**: helps generate/refine workflows (opt-in)

![Runs preview](.github/assets/runs-preview-1.png)

> [!TIP]
> This article includes more demo examples
> [Maia - Self-hosted DAG workflow orchestration and execution service](https://obiscr.com/blog/maia)

## Quick start

### Docker self host

Prerequisites: Docker + Docker Compose v2.

1) Download `docker-compose.release.yml` and `.env.production`

```bash
curl -fsSL -o docker-compose.release.yml https://raw.githubusercontent.com/obiscr/maia/main/docker-compose.release.yml
curl -fsSL -o .env.production https://raw.githubusercontent.com/obiscr/maia/main/env.example
```

2) Edit `.env.production` file and setup `RUNNER_TOKEN`

```dotenv
RUNNER_TOKEN=your-token
```

3) Start

```bash
docker compose -f docker-compose.release.yml --env-file .env.production up -d
```

On the first startup, `migrator` runs the database migrations (`prisma migrate deploy`) first. After it completes successfully, it exits automatically, and only then will `maia` / `runner` start and begin serving requests.

Open `http://localhost:3690` to set up.

### Run locally with Dev

See [Run locally with Dev](https://maia.obiscr.com/quick-start/build-from-source-dev/)

### Run locally with Docker

See [Run locally with Docker](https://maia.obiscr.com/quick-start/build-from-source-docker/)

## Releases

- Changelog: `CHANGELOG.md`

## Project links

- Documentation [maia.obiscr.com](https://maia.obiscr.com/)
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
