# Changelog

All notable changes to this project will be documented in this file.

This project aims to follow [Semantic Versioning](https://semver.org/) when releases are cut.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## Unreleased

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

