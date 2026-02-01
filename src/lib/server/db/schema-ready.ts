import "server-only"

import fs from "node:fs"
import path from "node:path"

import { resolveMaiaDataDirSync } from "@/lib/server/maia/instance-location"

function currentSqlitePathSync() {
  return path.join(resolveMaiaDataDirSync(), "db.sqlite")
}

function latestMigrationNameSync(): string | null {
  try {
    const root = path.join(process.cwd(), "prisma", "migrations")
    const ents = fs.readdirSync(root, { withFileTypes: true })
    const dirs = ents.filter((e) => e.isDirectory()).map((e) => e.name)
    dirs.sort((a, b) => a.localeCompare(b))
    return dirs.length ? (dirs[dirs.length - 1] ?? null) : null
  } catch {
    return null
  }
}

/**
 * Best-effort, dependency-light readiness check.
 *
 * Goal: avoid Prisma queries (and noisy "table does not exist" logs) before the schema is initialized.
 *
 * Notes:
 * - This does NOT run migrations.
 * - It checks whether the latest migration has been applied (preferred),
 *   falling back to a known table existence check when migrations are not available.
 */
export function isCurrentDatabaseSchemaReadySync(): boolean {
  const dbPath = currentSqlitePathSync()
  try {
    if (!fs.existsSync(dbPath)) return false
  } catch {
    return false
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const BetterSqlite3 = require("better-sqlite3") as new (p: string, opts?: unknown) => any
    const db = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true })
    try {
      const latest = latestMigrationNameSync()
      if (latest) {
        // Prisma migrate deploy marks a migration as applied by setting finished_at.
        const row = db
          .prepare(
            "SELECT 1 AS ok FROM _prisma_migrations WHERE migration_name = ? AND finished_at IS NOT NULL AND rolled_back_at IS NULL LIMIT 1",
          )
          .get(latest)
        if (row?.ok) return true
      }

      // Fallback: check a known table (legacy / extreme minimal installs).
      const row2 = db
        .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='Installation' LIMIT 1")
        .get()
      return Boolean(row2?.ok)
    } finally {
      db.close()
    }
  } catch {
    return false
  }
}
