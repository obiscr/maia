import path from "node:path"
import { constants as FS_CONSTANTS } from "node:fs"
import fs from "node:fs/promises"
import { z } from "zod"

import { prisma, switchDatabaseUrl } from "@/lib/server/db"
import { prismaMigrateDeploy } from "@/lib/server/db/prisma-migrate"
import { isCurrentDatabaseSchemaReadySync } from "@/lib/server/db/schema-ready"
import { fail, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { ensureDir } from "@/lib/server/maia/fs"
import {
  instanceConfigPathSync,
  isDataDirControlledByEnvSync,
  readInstanceConfig,
  resolveDataDirSync,
  writeInstanceConfig,
} from "@/lib/server/maia/instance-config"
import { expandHome, toSqliteDatabaseUrl } from "@/lib/server/maia/instance-location"
import { zodIssues } from "@/lib/shared/http/zod"

export const runtime = "nodejs"

const updateSchema = z.object({
  // empty / null => reset to default
  dataDir: z.union([z.string(), z.null()]).optional(),
})

const validateSchema = z.object({
  dataDir: z.string().optional(),
})

async function validateDataDir(raw: string) {
  const input = String(raw ?? "").trim()
  if (!input) return { ok: false as const, code: "DATA_DIR_REQUIRED" as const }

  const expanded = expandHome(input)
  if (!path.isAbsolute(expanded)) return { ok: false as const, code: "DATA_DIR_MUST_BE_ABSOLUTE" as const }
  const resolved = expanded

  // If exists: must be directory and r/w/x.
  try {
    const st = await fs.stat(resolved)
    if (!st.isDirectory()) return { ok: false as const, code: "DATA_DIR_NOT_DIRECTORY" as const }
  } catch (e) {
    const code = typeof (e as { code?: unknown })?.code === "string" ? String((e as { code?: unknown }).code) : null
    if (code !== "ENOENT") {
      return {
        ok: false as const,
        code: "DATA_DIR_STAT_FAILED" as const,
        meta: { fsCode: code ?? "UNKNOWN" },
      }
    }
    return { ok: false as const, code: "DATA_DIR_NOT_FOUND" as const }
  }

  // Access + real write test.
  try {
    await fs.access(resolved, FS_CONSTANTS.R_OK | FS_CONSTANTS.W_OK | FS_CONSTANTS.X_OK)
  } catch (e) {
    const code = typeof (e as { code?: unknown })?.code === "string" ? String((e as { code?: unknown }).code) : null
    return {
      ok: false as const,
      code: "DATA_DIR_NOT_ACCESSIBLE" as const,
      meta: { fsCode: code ?? "UNKNOWN" },
    }
  }

  const probe = path.join(resolved, `.maia-probe-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`)
  try {
    await fs.writeFile(probe, "probe", "utf8")
    await fs.unlink(probe)
  } catch (e) {
    const code = typeof (e as { code?: unknown })?.code === "string" ? String((e as { code?: unknown }).code) : null
    try {
      await fs.unlink(probe)
    } catch {}
    return {
      ok: false as const,
      code: "DATA_DIR_NOT_WRITABLE" as const,
      meta: { fsCode: code ?? "UNKNOWN" },
    }
  }

  return { ok: true as const, resolved }
}

export const GET = withApiObservability(async () => {
  const cfg = await readInstanceConfig().catch(() => ({ dataDir: undefined as string | undefined }))
  const effectiveDataDir = resolveDataDirSync()
  const effectiveDatabaseUrl = toSqliteDatabaseUrl(effectiveDataDir)
  const lockedByEnv = isDataDirControlledByEnvSync()

  return ok({
    config: {
      dataDir: typeof cfg.dataDir === "string" ? cfg.dataDir : null,
    },
    effective: {
      dataDir: effectiveDataDir,
      databaseUrl: effectiveDatabaseUrl,
    },
    meta: {
      lockedByEnv,
      configPath: instanceConfigPathSync(),
    },
  })
})

export const POST = withApiObservability(async (req: Request) => {
  let body: z.infer<typeof validateSchema>
  try {
    body = validateSchema.parse(await req.json().catch(() => ({})))
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    throw e
  }

  const raw = String(body.dataDir ?? "").trim()
  const validated = await validateDataDir(raw)
  if (!validated.ok) return fail({ status: 422, code: validated.code, meta: validated.meta })
  return ok({ ok: true, resolved: validated.resolved })
})

export const PUT = withApiObservability(async (req: Request) => {
  // If MAIA_DATA_DIR is set, env is the source of truth.
  if (isDataDirControlledByEnvSync()) return fail({ status: 409, code: "DATA_DIR_LOCKED_BY_ENV" })

  // Disallow changing data dir after initialization.
  const schemaReady = isCurrentDatabaseSchemaReadySync()
  const [inst, userCount] = schemaReady
    ? await Promise.all([
        prisma.installation
          .findUnique({ where: { id: "installation" }, select: { installedAt: true } })
          .catch(() => null),
        prisma.user.count().catch(() => 0),
      ])
    : [null, 0]
  if (inst?.installedAt || userCount > 0) return fail({ status: 409, code: "ALREADY_INITIALIZED" })

  let body: z.infer<typeof updateSchema>
  try {
    body = updateSchema.parse(await req.json().catch(() => ({})))
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    throw e
  }

  const raw = body.dataDir
  const nextConfigDataDir = raw == null ? null : String(raw).trim()

  // Validate before persisting config / switching DB.
  if (nextConfigDataDir) {
    const validated = await validateDataDir(nextConfigDataDir)
    if (!validated.ok) return fail({ status: 422, code: validated.code, meta: validated.meta })
  }

  // Persist config.
  await writeInstanceConfig({ dataDir: nextConfigDataDir || undefined })

  // Switch Prisma to new DB location (and ensure dirs exist).
  const effectiveDataDir = resolveDataDirSync()
  try {
    await ensureDir(effectiveDataDir)
  } catch (e) {
    const code = typeof (e as { code?: unknown })?.code === "string" ? String((e as { code?: unknown }).code) : null
    return fail({
      status: 422,
      code: "DATA_DIR_CREATE_FAILED",
      meta: { fsCode: code ?? "UNKNOWN" },
    })
  }
  const nextUrl = toSqliteDatabaseUrl(effectiveDataDir)
  const switched = await switchDatabaseUrl(nextUrl).catch(() => ({ ok: true as const, changed: false }))

  // Ensure DB schema exists for the new location (local/dev only).
  const migrated = await prismaMigrateDeploy()
  if (!migrated.ok) {
    const status = migrated.code === "MIGRATOR_REQUIRED" ? 409 : 500
    return fail({ status, code: migrated.code, meta: migrated.meta })
  }

  return ok({
    ok: true,
    switched,
    migrated: true,
    effective: {
      dataDir: effectiveDataDir,
      databaseUrl: nextUrl,
    },
  })
})
