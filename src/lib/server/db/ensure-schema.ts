import "server-only"

import { migrateCurrentSqliteDatabase } from "@/lib/server/db/migrate-sqlite"
import { isCurrentDatabaseSchemaReadySync } from "@/lib/server/db/schema-ready"

declare global {
  // Best-effort in-process lock to avoid concurrent first-run migrations.
  // (For multi-process deployments, SQLite file locking still protects, but this reduces noise.)
  var __maiaEnsureSqliteSchemaPromise: Promise<void> | null | undefined
}

/**
 * Ensure the current SQLite DB has the Prisma schema applied.
 *
 * Why:
 * - In local dev, the setup wizard can trigger migrations via "change data dir" flows.
 * - In containers, MAIA_DATA_DIR is commonly set (locking the data dir), so that flow may not run.
 * - End result: db.sqlite file exists but tables don't, causing Prisma "table does not exist" errors.
 */
export async function ensureCurrentSqliteSchemaReady(): Promise<void> {
  if (isCurrentDatabaseSchemaReadySync()) return

  const existing = globalThis.__maiaEnsureSqliteSchemaPromise
  if (existing) return await existing

  const p = (async () => {
    // Re-check inside the lock.
    if (isCurrentDatabaseSchemaReadySync()) return

    const res = await migrateCurrentSqliteDatabase().catch((e) => {
      throw e instanceof Error ? e : new Error(String(e))
    })
    if (!res?.ok) throw new Error("SQLITE_MIGRATION_FAILED")
  })().catch((e) => {
    // Allow future retries after a failure.
    globalThis.__maiaEnsureSqliteSchemaPromise = null
    throw e
  })

  globalThis.__maiaEnsureSqliteSchemaPromise = p
  await p
}
