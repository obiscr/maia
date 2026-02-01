# Changelog

All notable changes to this project will be documented in this file.

This project aims to follow [Semantic Versioning](https://semver.org/) when releases are cut.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## Unreleased

## v0.2.0

### Breaking

- **Self-host (Docker, prebuilt images)**: the release compose now includes a one-shot `migrator` service that runs `prisma migrate deploy` **before** the app starts. If you previously downloaded `docker-compose.release.yml`, you **must** update it before upgrading, otherwise migrations won't run.
  - Update: `curl -fsSL -o docker-compose.release.yml https://raw.githubusercontent.com/obiscr/maia/main/docker-compose.release.yml`
  - Then upgrade as usual: `docker compose -f docker-compose.release.yml --env-file .env.production pull` and `docker compose -f docker-compose.release.yml --env-file .env.production up -d --remove-orphans`

### Added

- **Email system**: SMTP configuration + test flow, email template management, and run notification emails.
- **Auth & security**: Magic Link sign-in, Email OTP, email confirmation, and TOTP 2FA (with recovery codes).
- **Admin**: user invites (list/create/revoke) and admin-triggered password reset via email.

### Changed

- **Signup policy**: allow invited users to sign up even when open registration is disabled.
- **Workflow editor UX**: unsaved-changes dialog for Output Spec; improved editor/canvas interactions and localized docs links.
- **Retry behavior**: normalized retry policy handling across workflow and batch routes.

### Fixed

- **Email OTP robustness**: persist token before sending; cleanup on failure.
- **Public URLs**: prefer configured public origin for absolute links.

### Migration

- **Docker (self-host, prebuilt images)**: see **Breaking** above (refresh `docker-compose.release.yml` before upgrading).
- **Database**: includes Prisma schema changes and migrations for email templates, SMTP settings, and auth security (TOTP/recovery codes). Run migrations during upgrade.
- **Config**: supports `MAIA_PUBLIC_ORIGIN` for generating externally reachable absolute URLs.

## v0.1.3

### Fixed

- Fixed the templates input/output spec.

## v0.1.2

### Added

- Workflow editor context menus.
- Attempt leases/heartbeats and per-step retry/backoff policy.

### Changed

- Migrate workflow input spec to v2 (`filesInput`).

### Fixed

- Make session cookie `Secure` policy proxy-aware (`SESSION_COOKIE_SECURE=auto`).
- Reject invalid workflow graphs (unknown deps / duplicates / cycles).
- Reconcile timed-out steps and lost workers to avoid stuck runs.

## v0.1.1

### Changed

- Automatically pull the sandbox container image when missing.

## v0.1.0

### Added

- Initial public development.

### Changed

- Auto-pull missing Docker images during container creation (runner `server.mjs`).

