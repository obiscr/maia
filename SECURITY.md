# Security Policy

## Supported Versions

This project is under active development. Security fixes are applied to the latest `main` branch.

## Reporting a Vulnerability

If you believe you have found a security vulnerability, please **do not open a public issue**.

Instead, report it privately via **GitHub Security Advisories** (preferred) or contact the maintainer privately via GitHub: `@obiscr`.

Include:

- A detailed description of the issue
- Steps to reproduce
- Impact assessment
- Any relevant logs (please redact secrets)

## Security notes (project-specific)

This project:

- Stores local state in the instance data directory (SQLite + artifacts; default folder name: `maia-data`). Treat it as sensitive if it may contain secrets.
- Accepts URL inputs for downloads; SSRF protections exist (blocking localhost/private IPs and DNS-resolved private addresses), but please report bypasses.
- Can install per-workflow npm dependencies in an isolated workflow directory. Avoid running untrusted workflows on shared machines.
