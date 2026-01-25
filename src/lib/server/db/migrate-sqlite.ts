import "server-only"

import fs from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"

import { resolveMaiaDataDirSync, toSqliteDatabaseUrl } from "@/lib/server/maia/instance-location"

function normalizeUrl(url: string) {
  return String(url ?? "").trim()
}

function sqliteFilePathFromUrl(url: string): string | null {
  const raw = normalizeUrl(url)
  if (!raw.startsWith("file:")) return null
  const noQuery = raw.split("?", 1)[0] ?? raw
  let p = noQuery.slice("file:".length)
  if (p.startsWith("///")) p = p.slice(2) // file:///abs -> /abs
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p)
}

function nowIso() {
  return new Date().toISOString()
}

function sha256Hex(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex")
}

async function listMigrationDirs(migrationsRoot: string) {
  const ents = await fs.readdir(migrationsRoot, { withFileTypes: true }).catch(() => [])
  return (
    ents
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      // Prisma names are lexicographically sortable (timestamp prefix).
      .sort((a, b) => a.localeCompare(b))
  )
}

export type SqliteMigrationResult = {
  ok: true
  applied: string[]
  skipped: string[]
  databaseUrl: string
  databaseFilePath: string
}

export type SqliteMigrationProgressEvent =
  | { type: "start"; migrationName: string }
  | { type: "applied"; migrationName: string }
  | { type: "skipped"; migrationName: string }

/**
 * Minimal SQLite migrator compatible with Prisma's migration.sql files under:
 * `prisma/migrations/<timestamp_name>/migration.sql`
 *
 * Why:
 * - Docker runtime image does not include Prisma CLI (devDependency).
 * - We still need a first-run UX that can initialize an empty SQLite DB file.
 *
 * Strategy:
 * - Use `better-sqlite3` if available and execute migration.sql as a script.
 * - Maintain `_prisma_migrations` table (subset of Prisma's contract) to track applied migrations.
 */
export async function migrateCurrentSqliteDatabase(params?: {
  databaseUrl?: string
  migrationsRoot?: string
  onProgress?: (evt: SqliteMigrationProgressEvent) => void
}): Promise<SqliteMigrationResult> {
  const databaseUrl = normalizeUrl(params?.databaseUrl ?? toSqliteDatabaseUrl(resolveMaiaDataDirSync()))
  if (!databaseUrl) throw new Error("databaseUrl is empty")

  const filePath = sqliteFilePathFromUrl(databaseUrl)
  if (!filePath) throw new Error("Only file: SQLite URLs are supported for auto-migrate")

  // First-run installs may not have the data directory yet.
  await fs.mkdir(path.dirname(filePath), { recursive: true })

  const migrationsRoot = params?.migrationsRoot ?? path.join(process.cwd(), "prisma", "migrations")
  const dirs = await listMigrationDirs(migrationsRoot)

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const BetterSqlite3 = require("better-sqlite3") as new (p: string) => any
  const db = new BetterSqlite3(filePath)

  // Ensure migration table exists (compatible enough for our tracking).
  db.exec(`
    CREATE TABLE IF NOT EXISTS _prisma_migrations (
      id TEXT PRIMARY KEY NOT NULL,
      checksum TEXT NOT NULL,
      finished_at TEXT,
      migration_name TEXT NOT NULL,
      logs TEXT,
      rolled_back_at TEXT,
      started_at TEXT NOT NULL,
      applied_steps_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS _prisma_migrations_migration_name ON _prisma_migrations(migration_name);
  `)

  const hasApplied = db.prepare(
    "SELECT 1 FROM _prisma_migrations WHERE migration_name = ? AND finished_at IS NOT NULL AND rolled_back_at IS NULL LIMIT 1",
  )
  const insertRow = db.prepare(
    "INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, applied_steps_count) VALUES (?, ?, ?, ?, ?)",
  )
  const finishRow = db.prepare(
    "UPDATE _prisma_migrations SET finished_at = ?, applied_steps_count = ? WHERE migration_name = ?",
  )
  const failRow = db.prepare("UPDATE _prisma_migrations SET logs = ? WHERE migration_name = ?")

  const applied: string[] = []
  const skipped: string[] = []

  for (const name of dirs) {
    const already = hasApplied.get(name)
    if (already) {
      skipped.push(name)
      params?.onProgress?.({ type: "skipped", migrationName: name })
      continue
    }

    params?.onProgress?.({ type: "start", migrationName: name })
    const sqlPath = path.join(migrationsRoot, name, "migration.sql")
    const sql = await fs.readFile(sqlPath, "utf8")

    const id = crypto.randomUUID()
    const checksum = sha256Hex(sql)
    const startedAt = nowIso()
    insertRow.run(id, checksum, name, startedAt, 0)

    try {
      const tx = db.transaction(() => {
        db.exec(sql)
      })
      tx()
      finishRow.run(nowIso(), 1, name)
      applied.push(name)
      params?.onProgress?.({ type: "applied", migrationName: name })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      failRow.run(msg, name)
      throw new Error(`Migration failed: ${name}: ${msg}`)
    }
  }

  db.close()

  return { ok: true as const, applied, skipped, databaseUrl, databaseFilePath: filePath }
}
