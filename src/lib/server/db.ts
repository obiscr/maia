import "server-only"

import fs from "fs"
import path from "path"
import { performance } from "perf_hooks"
import { PrismaClient } from "@prisma/client"

import { recordDbQuery } from "@/lib/server/observability/request-store"
import { resolveMaiaDataDirSync, toSqliteDatabaseUrl } from "@/lib/server/maia/instance-location"

declare global {
  var __prisma: PrismaClient | undefined
  var __prismaObsInstalled: boolean | undefined
  var __sqlitePragmaInit: Promise<void> | null | undefined
}

function normalizeSqliteUrl(url: string) {
  return String(url ?? "").trim()
}

function sqliteFilePathFromUrl(url: string): string | null {
  const raw = normalizeSqliteUrl(url)
  if (!raw.startsWith("file:")) return null
  const noQuery = raw.split("?", 1)[0] ?? raw
  let p = noQuery.slice("file:".length)
  // Common variants:
  // - file:./relative/path.db
  // - file:/abs/path.db
  // - file:///abs/path.db
  if (p.startsWith("///")) p = p.slice(2) // -> "/abs/..."
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p)
}

function ensureSqliteDirForUrl(url: string) {
  const fp = sqliteFilePathFromUrl(url)
  if (!fp) return
  fs.mkdirSync(path.dirname(fp), { recursive: true })
}

// Single source of truth for the active DB connection.
let currentDbUrl = toSqliteDatabaseUrl(resolveMaiaDataDirSync())
ensureSqliteDirForUrl(currentDbUrl)

function createSqliteAdapter() {
  const url = currentDbUrl

  // Prefer better-sqlite3 when available; otherwise fall back to libsql.
  const hasBetterSqlite3Binding = (() => {
    try {
      const base = path.join(process.cwd(), "node_modules", "better-sqlite3")
      const candidates = [
        path.join(base, "build", "Release", "better_sqlite3.node"),
        path.join(base, "build", "Debug", "better_sqlite3.node"),
        path.join(base, "build", "better_sqlite3.node"),
        path.join(base, "lib", "binding"),
        path.join(base, "compiled"),
      ]
      return candidates.some((p) => fs.existsSync(p))
    } catch {
      return false
    }
  })()

  if (hasBetterSqlite3Binding) {
    const { PrismaBetterSqlite3 } =
      require("@prisma/adapter-better-sqlite3") as typeof import("@prisma/adapter-better-sqlite3")
    return new PrismaBetterSqlite3({ url })
  }

  const { PrismaLibSql } = require("@prisma/adapter-libsql") as typeof import("@prisma/adapter-libsql")
  // Optional Turso token support (ignored for file: URLs).
  const authToken = process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN || undefined
  return new PrismaLibSql({ url, authToken })
}

function installPrismaObservability(p: PrismaClient) {
  // Prisma 6+ favors query extensions; middleware ($use) may not exist in some builds.
  if (typeof p?.$extends === "function") {
    const extended = p.$extends({
      query: {
        $allModels: {
          $allOperations: async (pp) => {
            const { model, operation, args, query } = pp as {
              model?: string
              operation: unknown
              args: unknown
              query: (args: unknown) => Promise<unknown>
            }
            const start = performance.now()
            try {
              return await query(args)
            } finally {
              const ms = performance.now() - start
              recordDbQuery({ model: model ?? undefined, action: String(operation), ms })
            }
          },
        },
      },
    })
    return extended as unknown as PrismaClient
  }

  const maybeUse = (p as unknown as { $use?: unknown }).$use
  if (typeof maybeUse === "function") {
    const prismaUse = p as unknown as {
      $use: (fn: (params: unknown, next: (params: unknown) => Promise<unknown>) => Promise<unknown>) => void
    }
    prismaUse.$use(async (params: unknown, next: (params: unknown) => Promise<unknown>) => {
      const pp = params as { model?: string; action?: unknown }
      const start = performance.now()
      try {
        return await next(params)
      } finally {
        const ms = performance.now() - start
        recordDbQuery({ model: pp.model ?? undefined, action: String(pp.action), ms })
      }
    })
  }
  return p
}

function createPrismaClient() {
  const base = new PrismaClient({
    log: ["error"],
    adapter: createSqliteAdapter(),
  })
  return installPrismaObservability(base)
}

let _prisma: PrismaClient = globalThis.__prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = _prisma
}

globalThis.__prismaObsInstalled = true

export let prisma: PrismaClient = _prisma as PrismaClient

export async function switchDatabaseUrl(nextUrlRaw: string): Promise<{ ok: true; changed: boolean }> {
  const nextUrl = normalizeSqliteUrl(nextUrlRaw)
  if (!nextUrl) return { ok: true as const, changed: false }

  const cur = normalizeSqliteUrl(currentDbUrl)
  if (cur === nextUrl) return { ok: true as const, changed: false }

  // Ensure target dir exists before opening new client.
  currentDbUrl = nextUrl
  ensureSqliteDirForUrl(nextUrl)

  const old = prisma
  const next = createPrismaClient()
  prisma = next
  globalThis.__prisma = next

  // Allow pragma init to re-run for the new DB.
  globalThis.__sqlitePragmaInit = null

  // Best-effort: disconnect old pool after swapping (avoid blocking new traffic).
  void old.$disconnect().catch(() => {})
  return { ok: true as const, changed: true }
}

/** SQLite correctness + concurrency tuning (best-effort). */
function getGlobalSqlitePragmaInit() {
  return globalThis.__sqlitePragmaInit ?? null
}

function setGlobalSqlitePragmaInit(p: Promise<void> | null) {
  globalThis.__sqlitePragmaInit = p
}

function isSqlitePragmaInTxnError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e)
  // SQLite prohibits changing certain pragmas (including synchronous) while a transaction is active.
  return msg.includes("may not be changed inside a transaction") || msg.includes("inside a transaction")
}

export function ensureSqlitePragmas() {
  const existing = getGlobalSqlitePragmaInit()
  if (existing) return existing

  const p = (async () => {
    const maxAttempts = 5
    let didSucceed = false
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Enforce FK constraints (SQLite defaults to OFF).
        await prisma.$queryRawUnsafe("PRAGMA foreign_keys = ON;")

        // Improve read/write concurrency (recommended for most server apps).
        await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL;")

        // Reduce fsync cost while keeping WAL safe enough for typical workloads.
        await prisma.$queryRawUnsafe("PRAGMA synchronous = NORMAL;")

        // Wait for locks instead of failing fast under brief contention.
        await prisma.$queryRawUnsafe("PRAGMA busy_timeout = 5000;")
        didSucceed = true
        return
      } catch (e) {
        console.warn(`[db] sqlite pragma init failed (non-fatal) [attempt ${attempt}/${maxAttempts}]:`, e)

        // If we happened to run while a transaction was active, retry a few times with backoff.
        if (isSqlitePragmaInTxnError(e) && attempt < maxAttempts) {
          const delayMs = Math.min(2000, 150 * 2 ** (attempt - 1))
          await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
          continue
        }
        return
      }
    }

    // If we only ever failed due to "in transaction" timing, allow a later caller to retry.
    // This avoids permanently "locking in" a failed init during engine ticks / concurrent startup.
    if (!didSucceed) setGlobalSqlitePragmaInit(null)
  })()

  setGlobalSqlitePragmaInit(p)
  return p
}
