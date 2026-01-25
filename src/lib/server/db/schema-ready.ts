import "server-only"

import fs from "node:fs"
import path from "node:path"

import { resolveMaiaDataDirSync } from "@/lib/server/maia/instance-location"

function currentSqlitePathSync() {
  return path.join(resolveMaiaDataDirSync(), "db.sqlite")
}

/**
 * Best-effort, dependency-light readiness check.
 *
 * Goal: avoid Prisma queries (and noisy "table does not exist" logs) before the schema is initialized.
 *
 * Notes:
 * - This does NOT run migrations.
 * - It only checks whether a known table exists.
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
      const row = db
        .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='Installation' LIMIT 1")
        .get()
      return Boolean(row?.ok)
    } finally {
      db.close()
    }
  } catch {
    return false
  }
}
