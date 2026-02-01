# Codebase Conventions

This document is for **contributors**. It defines the minimal set of rules for:

- Where code should live (repo layout)
- Naming conventions
- Module boundaries (client/shared/server)
- The **SSE + React Query** pattern used across the app

## Repository Layout (High Level)

- **Routes & API**: `src/app/**` (Next.js App Router)
  - Keep `page.tsx/layout.tsx/loading.tsx` thin: param parsing + composing page components
  - API routes live under `src/app/api/**`
- **Authenticated app UI**: `src/app/(app)/**`
  - The `(app)` route group is the authenticated surface.
  - Server-side auth is enforced in `src/app/(app)/layout.tsx` via `requireAuthedUser()` (DB-backed session validation).
  - Middleware is not a security boundary; it is UX only.
- **UI (domain-oriented)**: `src/components/<domain>/**` (e.g. `runs`, `jobs`, `workflows`, `schedules`, `batches`, `operations`, `settings`)
- **UI (cross-domain, low business semantics)**: `src/components/common/**`
- **UI primitives (no business semantics)**: `src/components/ui/**`
- **Hooks**: `src/hooks/**`
- **Libraries (layered)**: `src/lib/**`
  - `src/lib/server/**`: Node/DB/FS/secrets (must include `import "server-only"`)
  - `src/lib/shared/**`: shared between client/server (must be runtime-safe)
  - `src/lib/client/**`: browser-only capabilities (SSE pool, toast, storage, Monaco, etc.)

## Module Boundaries (Hard Rules)

- **Do not import `src/lib/server/**` from `"use client"` components**
  - Guarded by `import "server-only"` and `pnpm check:client-imports`
- **Do not import another domain’s internal implementation directly**
  - If something must be shared, lift it to `src/components/common`, a dedicated feature folder, or `src/lib/shared`

## Naming Conventions

- **Component files**: `kebab-case.tsx`
- **Hooks**: `use-*.ts`
- **Client page containers**: `*-client.tsx`
- **Panels / sections**: `*-panel.tsx`
- **Overlays**: `*-sheet.tsx` / `*-dialog.tsx`

## SSE Protocol (`/api/stream`)

- **Endpoint**: `GET /api/stream?topic=<kind:id>`
  - Optional: `fromId=<number>` (resume / replay from cursor)
  - Optional: `from=latest` or `replay=none` (tail on first connect; if `fromId` is provided, `fromId` wins)
- **Server**: `src/app/api/stream/route.ts`
  - Replays up to 2000 events, then continues with in-memory bus delivery **and** a polling fallback (for cross-process producers)
  - Sends keepalive comments and rotates long-lived connections
- **Client**: always use `useTopicStream` (`src/hooks/use-topic-stream.ts`); do not manually create `EventSource`

### Topic Format

- A topic string is always: `${kind}:${id}`
- `kind` must be in `KNOWN_STREAM_TOPIC_KINDS` (`src/lib/shared/realtime/topics.ts`)
- **List streams** exist only for a subset of kinds (`LIST_STREAM_TOPIC_KINDS`)
  - Admin list: `${kind}:list_admin`
  - User list: `${kind}:list_<userPublicId>`
  - Helpers: `makeAdminListStreamTopic` / `makeUserListStreamTopic`

### Cursor Persistence (When to Disable)

`useTopicStream` persists `Last-Event-ID` to `sessionStorage` (default key: `maia.topicCursor:${topic}`) and sends it back as `fromId`.

- **persistCursor=true (default)**: best for “infinite” list streams (most list pages)
- **persistCursor=false**: best for “finite/history” streams where you want a fresh replay on each visit

## React Query + SSE (List Pages)

Use `useListSsePatch` (`src/hooks/realtime/use-list-sse-patch.ts`). Pick one strategy per surface:

- **A: Patch cache** (more real-time, fewer requests): the payload can reliably identify the row and changed fields
- **B: Debounce refetch** (simpler, more robust): sorting/filtering is complex or payload is insufficient to patch safely
