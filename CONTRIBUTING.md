# Contributing to Maia

Thanks for your interest in contributing!

## License (inbound = outbound)

By submitting a pull request, patch, or other contribution to this repository, you confirm that:

- You have the right to submit the contribution (it is your original work, or you have permission from the rights holder / your employer), and
- You license your contribution under the project's license.

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in the project by you will be licensed under the MIT License, without any additional terms or conditions.

## DCO (Signed-off-by required)

This project uses the Developer Certificate of Origin (DCO). Every commit in a pull request must include a `Signed-off-by` line.

- DCO text: `DCO`
- More details: [Developer Certificate of Origin](https://developercertificate.org/)

### How to sign off

- **New commits**: use `git commit -s` (adds the `Signed-off-by` line automatically).
- **Fix an existing PR**: rewrite your commits (e.g. interactive rebase) and sign them off.

## Development setup

### Prerequisites

- Node.js 20+
- pnpm (via Corepack)

### Install & run

```bash
corepack enable
pnpm install
pnpm prisma:generate
pnpm dev
```

Open `http://localhost:3000`.

### Quality checks (required for PRs)

Run the full check suite:

```bash
pnpm check-all
```

This runs:

- `pnpm lint`
- `pnpm type-check`
- `pnpm check:client-imports` (ensures `"use client"` does not import `server-only` modules)
- `pnpm check:framework`
- `pnpm build`
- `pnpm test:e2e`

### Common commands

- **Format**: `pnpm format` (check: `pnpm format:check`)
- **Lint**: `pnpm lint`
- **Type check**: `pnpm type-check`
- **i18n check**: `pnpm check:i18n`
- **Full PR check**: `pnpm check-all`
- **E2E smoke**: `pnpm test:e2e`

## Project structure (high level)

- `src/app/*`: Next.js App Router pages and API routes
- `src/lib/server/maia/*`: workflow engine + filesystem + deps installation (server-only)
- `src/lib/server/agent/*`: agent / LLM integration (server-only for network + secrets)
- `src/components/*`: UI components
- `src/lib/shared/i18n/*`: i18n dictionaries + helpers (shared)
- `docs/*`: architecture, module boundaries, terminology

## Routing & auth conventions (important)

- **Authenticated UI pages** must live under `src/app/(app)/**`
  - The `(app)` route group is protected by a server-side gate in `src/app/(app)/layout.tsx` (calls `requireAuthedUser()`).
  - If you intentionally add an authenticated page outside `src/app/(app)/**` (rare), the page/layout must call `requireAuthedUser()` explicitly.
- **Public pages** (setup + auth flows) live outside `(app)` (e.g. `src/app/setup/**`, `src/app/signin/**`, `src/app/auth/**`).
- **Do not treat `src/middleware.ts` as a security boundary**
  - Middleware exists for UX (redirect + returnTo cookie). All real auth decisions must happen server-side (DB-backed session validation).

## Module boundaries (important)

Some modules are server-only and are protected by `import "server-only";`.
Do not import them from `"use client"` components.

See `docs/CODEBASE_CONVENTIONS.md` for the full rules (including SSE + React Query conventions).

## i18n guidelines

- **Key shape**: `domain[.page][.section].nameSuffix` (e.g. `t("jobs.list.actions.copyJobIdAction")`)
- **Group by feature first**: top-level keys are product areas like `jobs`, `runs`, `schedules`, `workflows`, etc.
- **Page-scoped keys live under common page buckets**: `list`, `detail`, `sheet`, `wizard`, etc. Put UI actions under `actions`.
- **Use consistent suffixes** (pick the closest match, don’t invent new ones per file): `Title`, `Description`, `Hint`, `Label`, `Tooltip`, `Action`, `Toast`, `Failed`, `EmptyState`, `NoResultsTitle`, etc.
- **Reuse shared strings via `common.*`** instead of duplicating across features.
- Prefer **static** keys (literal strings in `t("...")`) so keys are searchable and checkable.
- **Allowed (controlled) key passing**: you may pass keys via variables/props only when the identifier clearly indicates it is an i18n key:
  - `*Key` (e.g. `titleKey`, `labelKey`, `descriptionKey`, `emptyKey`)
  - or `messageKey`, `fallbackKey`, `i18nKey`
  - Pattern: `t(titleKey)` ✅, `t(key)` ❌
- **Disallow dynamic key building**: do not concatenate or template keys (e.g. `t("errors." + code)`, `t(\`errors.${code}\`)`).
  - Use a **static mapping** (`Record<Enum, Key>`) or attach a `...Key` field to your data/config instead.
- **Keep locale files in sync**: update both `src/lib/shared/i18n/en.json` and `src/lib/shared/i18n/zh-cn.json` with the same key structure.
- **Interpolation**: use `{var}` placeholders (e.g. `"Lease expires: {iso}"`).
- **Rich text**: for tooltip-ish strings that need emphasis/code, use `RichTextI18n` and only the whitelist tags:
  - `<strong>...</strong>`, `<code>...</code>`, `<br/>`
  - Prefer suffixes like `HintRich` / `DescriptionRich` for these keys.

You can verify missing keys with:

```bash
pnpm check:i18n
```

## Time formatting guidelines

- **Canonical timestamp format (storage/transport)**: use **ISO 8601 strings** (e.g. from `Date.toISOString()`), not locale-formatted strings.
- **UI absolute time**: always use `formatAbsoluteTime(iso, { locale, timeZone })` from `src/lib/shared/format/time.ts`.
  - Output is always **`YYYY-MM-DD HH:mm:ss`** (24-hour), regardless of locale.
  - Missing values display as `—`. Invalid timestamps fall back to the original string.
- **UI relative time**: use `formatRelativeTimeFromNow(iso, { now, locale })`.
- **Durations**: prefer `calcDurationMs(startedAtIso, finishedAtIso, { now })` + `formatDurationMs(ms, { locale })`.
- **Time zones**:
  - When available, use the user’s UI timezone (IANA name like `Asia/Shanghai`, or `UTC`) and pass it as `timeZone`.
  - `null` means “fall back to the runtime/browser timezone”.
- **Avoid**: `toLocaleString()`, `Date.toString()`, or ad-hoc date formatting/parsing in UI. Keep formatting centralized.

## Submitting changes

1. Create a branch from `main`.
2. Keep PRs focused (one topic per PR).
3. Ensure `pnpm check-all` passes.
4. Add/update docs when changing architecture or behavior.

## Reporting issues

Please include:

- What you expected vs what happened
- Steps to reproduce
- Your OS + Node version
- Any relevant logs (redact secrets)
