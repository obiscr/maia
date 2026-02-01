import path from "node:path"
import fs from "node:fs/promises"
import { spawn } from "node:child_process"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

function envString(k, fallback = "") {
  const v = process.env[k]
  return typeof v === "string" && v.trim() ? v.trim() : fallback
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true })
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", ...opts })
    child.on("error", reject)
    child.on("exit", (code) => resolve(typeof code === "number" ? code : 1))
  })
}

function runWithStdin(cmd, args, input, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "inherit", "inherit"], ...opts })
    child.on("error", reject)
    child.stdin.write(input)
    child.stdin.end()
    child.on("exit", (code) => resolve(typeof code === "number" ? code : 1))
  })
}

async function preflightPrismaMigrationsTable() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const BetterSqlite3 = require("better-sqlite3")

  const dataDir = envString("MAIA_DATA_DIR", "/app/maia-data")
  await ensureDir(dataDir)

  const dbPath = path.join(dataDir, "db.sqlite")
  const db = new BetterSqlite3(dbPath)

  try {
    try {
      db.pragma("busy_timeout = 5000")
    } catch {}

    const hasTable = db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='_prisma_migrations' LIMIT 1")
      .get()
    if (!hasTable?.ok) return

    // If Maia <= prod release created a UNIQUE index on migration_name, drop it.
    db.exec('DROP INDEX IF EXISTS "_prisma_migrations_migration_name";')

    // Prisma Migrate expects a specific _prisma_migrations schema. Older Maia builds created a compatible
    // *subset* but with TEXT datetime columns, which can break Prisma's parsing. Rebuild it to match Prisma 7.2.
    const tx = db.transaction(() => {
      db.exec('DROP TABLE IF EXISTS "_prisma_migrations_new";')
      db.exec(`
        CREATE TABLE "_prisma_migrations_new" (
          "id"                    TEXT PRIMARY KEY NOT NULL,
          "checksum"              TEXT NOT NULL,
          "finished_at"           DATETIME,
          "migration_name"        TEXT NOT NULL,
          "logs"                  TEXT,
          "rolled_back_at"        DATETIME,
          "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
          "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
        );
      `)

      const normExpr = (col) =>
        `CASE
          WHEN ${col} IS NULL OR trim(${col}) = '' THEN NULL
          ELSE substr(replace(replace(trim(${col}), 'T', ' '), 'Z', ''), 1, 19)
        END`

      db.exec(`
        INSERT INTO "_prisma_migrations_new"
          (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
        SELECT
          id,
          checksum,
          ${normExpr("finished_at")} AS finished_at,
          migration_name,
          logs,
          ${normExpr("rolled_back_at")} AS rolled_back_at,
          COALESCE(${normExpr("started_at")}, current_timestamp) AS started_at,
          COALESCE(applied_steps_count, 0) AS applied_steps_count
        FROM "_prisma_migrations";
      `)

      db.exec('DROP TABLE "_prisma_migrations";')
      db.exec('ALTER TABLE "_prisma_migrations_new" RENAME TO "_prisma_migrations";')
    })

    tx()
  } finally {
    db.close()
  }
}

async function main() {
  // Compatibility preflight for existing installations.
  // If this fails, we want the migrator to fail loudly (otherwise migrate deploy can error cryptically).
  await preflightPrismaMigrationsTable()

  // Use the repo script so we always run the project-pinned Prisma version.
  const code = await run("pnpm", ["prisma:migrate"], { env: process.env })
  process.exit(code)
}

await main()
