import { z } from "zod"
import os from "node:os"

import { getAuthedUserFromRequest } from "@/lib/server/auth/session"
import { fail, ok } from "@/lib/server/http/response"
import { mark, withApiObservability } from "@/lib/server/observability"
import { prisma } from "@/lib/server/db"
import { ensureInstallationRowTx, getInstallation } from "@/lib/server/installation"
import {
  SYSTEM_SECRET_KEYS,
  getSystemSecretPlaintext,
  deleteSystemSecretTx,
  hasSystemSecretTx,
  upsertSystemSecretTx,
} from "@/lib/server/settings/system-secrets"
import { readRuntimeSettingsSync, writeRuntimeSettings, type RuntimeSettings } from "@/lib/server/maia/runtime-settings"
import { zodIssues } from "@/lib/shared/http/zod"

export const runtime = "nodejs"

type PerfSource = "override" | "env" | "default" | "invalid_env"

type OsWithAvailableParallelism = typeof os & { availableParallelism?: () => number }

const runtimePerfKeys = [
  "globalRunConcurrency",
  "perRunStepConcurrency",
  "defaultStepTimeoutMs",
  "inputDownloadConcurrency",
  "inputDownloadTimeoutMs",
  "inputDownloadMaxBytes",
] as const satisfies readonly (keyof RuntimeSettings)[]

function isTruthyEnv(name: string) {
  const raw = String(process.env[name] ?? "")
    .trim()
    .toLowerCase()
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on"
}

function isPerformanceLocked() {
  return isTruthyEnv("SYSTEM_PERFORMANCE_LOCKED")
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function readIntEnv(name: string) {
  const raw = String(process.env[name] ?? "").trim()
  if (!raw) return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return NaN
  return Math.floor(n)
}

function getAvailableParallelism() {
  const maybe = (os as unknown as OsWithAvailableParallelism).availableParallelism
  return typeof maybe === "function" ? Number(maybe()) : os.cpus().length
}

function defaultGlobalRunConcurrency() {
  const avail = getAvailableParallelism()
  const safe = Math.max(1, Math.floor((Number.isFinite(avail) ? avail : 2) / 2))
  return Math.min(4, safe)
}

function computePerfMeta(params: { override: unknown; envName: string; fallback: number; min: number; max: number }) {
  if (typeof params.override === "number" && Number.isFinite(params.override)) {
    return { effective: clampInt(params.override, params.min, params.max), source: "override" as const }
  }
  const env = readIntEnv(params.envName)
  if (env === null) return { effective: clampInt(params.fallback, params.min, params.max), source: "default" as const }
  if (!Number.isFinite(env))
    return { effective: clampInt(params.fallback, params.min, params.max), source: "invalid_env" as const }
  return { effective: clampInt(env, params.min, params.max), source: "env" as const }
}

const registrationModeSchema = z.enum(["DISABLED", "OPEN", "INVITE_ONLY"])

const updateSchema = z.object({
  registrationMode: registrationModeSchema.optional(),

  smtpEnabled: z.boolean().optional(),
  smtpHost: z.union([z.string(), z.null()]).optional(),
  smtpPort: z.union([z.number().int().min(1).max(65535), z.null()]).optional(),
  smtpSecure: z.boolean().optional(),
  smtpUsername: z.union([z.string(), z.null()]).optional(),
  smtpFromEmail: z.union([z.string().email(), z.null()]).optional(),
  smtpFromName: z.union([z.string(), z.null()]).optional(),

  // null => clear; string => set/update; undefined => unchanged
  smtpPassword: z.union([z.string(), z.null()]).optional(),

  // Advanced runtime tuning (system-wide; persisted to data dir).
  globalRunConcurrency: z.union([z.number().int().min(1).max(10_000), z.null()]).optional(),
  perRunStepConcurrency: z.union([z.number().int().min(1).max(10_000), z.null()]).optional(),
  defaultStepTimeoutMs: z
    .union([
      z
        .number()
        .int()
        .min(1_000)
        .max(24 * 60 * 60 * 1000),
      z.null(),
    ])
    .optional(),
  inputDownloadConcurrency: z.union([z.number().int().min(1).max(10_000), z.null()]).optional(),
  inputDownloadTimeoutMs: z
    .union([
      z
        .number()
        .int()
        .min(1_000)
        .max(60 * 60 * 1000),
      z.null(),
    ])
    .optional(),
  inputDownloadMaxBytes: z
    .union([
      z
        .number()
        .int()
        .min(1)
        .max(10 * 1024 * 1024 * 1024),
      z.null(),
    ])
    .optional(),
})

function requireAdmin(user: { role: string }) {
  if (String(user.role) !== "ADMIN") return false
  return true
}

export const GET = withApiObservability(async (req: Request) => {
  const user = await getAuthedUserFromRequest(req).catch(() => null)
  if (!user) return fail({ status: 401, code: "UNAUTHORIZED" })
  if (!requireAdmin(user)) return fail({ status: 403, code: "FORBIDDEN" })

  const [inst, smtpPassword] = await Promise.all([
    getInstallation().catch(() => null),
    getSystemSecretPlaintext({ key: SYSTEM_SECRET_KEYS.smtpPassword }).catch(() => null),
  ])
  const passConfigured = Boolean(smtpPassword)
  const runtime = readRuntimeSettingsSync()
  const perfLocked = isPerformanceLocked()

  const perfMeta = {
    globalRunConcurrency: computePerfMeta({
      override: runtime.globalRunConcurrency,
      envName: "GLOBAL_RUN_CONCURRENCY",
      fallback: defaultGlobalRunConcurrency(),
      min: 1,
      max: 10_000,
    }),
    perRunStepConcurrency: computePerfMeta({
      override: runtime.perRunStepConcurrency,
      envName: "PER_RUN_STEP_CONCURRENCY",
      fallback: 2,
      min: 1,
      max: 10_000,
    }),
    defaultStepTimeoutMs: computePerfMeta({
      override: runtime.defaultStepTimeoutMs,
      envName: "DEFAULT_STEP_TIMEOUT_MS",
      fallback: 10 * 60 * 1000,
      min: 1_000,
      max: 24 * 60 * 60 * 1000,
    }),
    inputDownloadConcurrency: computePerfMeta({
      override: runtime.inputDownloadConcurrency,
      envName: "INPUT_DOWNLOAD_CONCURRENCY",
      fallback: 2,
      min: 1,
      max: 10_000,
    }),
    inputDownloadTimeoutMs: computePerfMeta({
      override: runtime.inputDownloadTimeoutMs,
      envName: "INPUT_DOWNLOAD_TIMEOUT_MS",
      fallback: 60_000,
      min: 1_000,
      max: 60 * 60 * 1000,
    }),
    inputDownloadMaxBytes: computePerfMeta({
      override: runtime.inputDownloadMaxBytes,
      envName: "INPUT_DOWNLOAD_MAX_BYTES",
      fallback: 50 * 1024 * 1024,
      min: 1,
      max: 10 * 1024 * 1024 * 1024,
    }),
  } satisfies Record<string, { effective: number; source: PerfSource }>

  return ok({
    locks: { performance: perfLocked },
    performance: {
      effective: {
        globalRunConcurrency: perfMeta.globalRunConcurrency.effective,
        perRunStepConcurrency: perfMeta.perRunStepConcurrency.effective,
        defaultStepTimeoutMs: perfMeta.defaultStepTimeoutMs.effective,
        inputDownloadConcurrency: perfMeta.inputDownloadConcurrency.effective,
        inputDownloadTimeoutMs: perfMeta.inputDownloadTimeoutMs.effective,
        inputDownloadMaxBytes: perfMeta.inputDownloadMaxBytes.effective,
      },
      source: {
        globalRunConcurrency: perfMeta.globalRunConcurrency.source,
        perRunStepConcurrency: perfMeta.perRunStepConcurrency.source,
        defaultStepTimeoutMs: perfMeta.defaultStepTimeoutMs.source,
        inputDownloadConcurrency: perfMeta.inputDownloadConcurrency.source,
        inputDownloadTimeoutMs: perfMeta.inputDownloadTimeoutMs.source,
        inputDownloadMaxBytes: perfMeta.inputDownloadMaxBytes.source,
      },
    },
    settings: {
      registrationMode: inst?.registrationMode ?? "DISABLED",
      smtpEnabled: Boolean(inst?.smtpEnabled),
      smtpHost: inst?.smtpHost ?? "",
      smtpPort: typeof inst?.smtpPort === "number" ? inst.smtpPort : null,
      smtpSecure: Boolean(inst?.smtpSecure),
      smtpUsername: inst?.smtpUsername ?? "",
      smtpFromEmail: inst?.smtpFromEmail ?? "",
      smtpFromName: inst?.smtpFromName ?? "",
      smtpPassword: smtpPassword ?? "",
      smtpPasswordConfigured: passConfigured,

      globalRunConcurrency: typeof runtime.globalRunConcurrency === "number" ? runtime.globalRunConcurrency : null,
      perRunStepConcurrency: typeof runtime.perRunStepConcurrency === "number" ? runtime.perRunStepConcurrency : null,
      defaultStepTimeoutMs: typeof runtime.defaultStepTimeoutMs === "number" ? runtime.defaultStepTimeoutMs : null,
      inputDownloadConcurrency:
        typeof runtime.inputDownloadConcurrency === "number" ? runtime.inputDownloadConcurrency : null,
      inputDownloadTimeoutMs:
        typeof runtime.inputDownloadTimeoutMs === "number" ? runtime.inputDownloadTimeoutMs : null,
      inputDownloadMaxBytes: typeof runtime.inputDownloadMaxBytes === "number" ? runtime.inputDownloadMaxBytes : null,
    },
  })
})

export const PUT = withApiObservability(async (req: Request) => {
  const user = await getAuthedUserFromRequest(req).catch(() => null)
  if (!user) return fail({ status: 401, code: "UNAUTHORIZED" })
  if (!requireAdmin(user)) return fail({ status: 403, code: "FORBIDDEN" })

  let body: z.infer<typeof updateSchema>
  try {
    body = updateSchema.parse(await req.json().catch(() => ({})))
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    throw e
  }

  const perfLocked = isPerformanceLocked()
  if (perfLocked) {
    const perfKeys = [
      "globalRunConcurrency",
      "perRunStepConcurrency",
      "defaultStepTimeoutMs",
      "inputDownloadConcurrency",
      "inputDownloadTimeoutMs",
      "inputDownloadMaxBytes",
    ] as const
    const touchingPerf = perfKeys.some((k) => body[k] !== undefined)
    if (touchingPerf) {
      return fail({
        status: 409,
        code: "SYSTEM_PERFORMANCE_LOCKED",
        meta: { env: "SYSTEM_PERFORMANCE_LOCKED" },
      })
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    // Ensure row exists even if installation record was not created yet (shouldn't happen in normal flow).
    await ensureInstallationRowTx(tx, {})

    if (typeof body.smtpPassword === "string") {
      const trimmed = String(body.smtpPassword ?? "").trim()
      if (trimmed) await upsertSystemSecretTx(tx, { key: SYSTEM_SECRET_KEYS.smtpPassword, plaintext: trimmed })
    } else if (body.smtpPassword === null) {
      await deleteSystemSecretTx(tx, { key: SYSTEM_SECRET_KEYS.smtpPassword })
    }

    const data: Record<string, unknown> = {}
    if (typeof body.registrationMode === "string") data.registrationMode = body.registrationMode

    if (typeof body.smtpEnabled === "boolean") data.smtpEnabled = body.smtpEnabled
    if (body.smtpHost === null) data.smtpHost = null
    else if (typeof body.smtpHost === "string") data.smtpHost = body.smtpHost.trim() || null

    if (body.smtpPort === null) data.smtpPort = null
    else if (typeof body.smtpPort === "number") data.smtpPort = body.smtpPort

    if (typeof body.smtpSecure === "boolean") data.smtpSecure = body.smtpSecure

    if (body.smtpUsername === null) data.smtpUsername = null
    else if (typeof body.smtpUsername === "string") data.smtpUsername = body.smtpUsername.trim() || null

    if (body.smtpFromEmail === null) data.smtpFromEmail = null
    else if (typeof body.smtpFromEmail === "string") data.smtpFromEmail = body.smtpFromEmail.trim() || null

    if (body.smtpFromName === null) data.smtpFromName = null
    else if (typeof body.smtpFromName === "string") data.smtpFromName = body.smtpFromName.trim() || null

    const inst = await tx.installation.update({
      where: { id: "installation" },
      data,
      select: {
        registrationMode: true,
        smtpEnabled: true,
        smtpHost: true,
        smtpPort: true,
        smtpSecure: true,
        smtpUsername: true,
        smtpFromEmail: true,
        smtpFromName: true,
      },
    })

    const passConfigured = await hasSystemSecretTx(tx, { key: SYSTEM_SECRET_KEYS.smtpPassword }).catch(() => false)
    return { inst, passConfigured }
  })

  // Persist runtime overrides (non-DB) after successful tx.
  {
    const current = readRuntimeSettingsSync()
    const next: RuntimeSettings = { ...current }
    for (const k of runtimePerfKeys) {
      const v = body[k]
      if (typeof v === "number") next[k] = v
      else if (v === null) next[k] = undefined
    }
    await writeRuntimeSettings(next).catch(() => {})
  }

  mark("write")
  const smtpPassword = await getSystemSecretPlaintext({ key: SYSTEM_SECRET_KEYS.smtpPassword }).catch(() => null)
  const runtime = readRuntimeSettingsSync()
  const perfMeta = {
    globalRunConcurrency: computePerfMeta({
      override: runtime.globalRunConcurrency,
      envName: "GLOBAL_RUN_CONCURRENCY",
      fallback: defaultGlobalRunConcurrency(),
      min: 1,
      max: 10_000,
    }),
    perRunStepConcurrency: computePerfMeta({
      override: runtime.perRunStepConcurrency,
      envName: "PER_RUN_STEP_CONCURRENCY",
      fallback: 2,
      min: 1,
      max: 10_000,
    }),
    defaultStepTimeoutMs: computePerfMeta({
      override: runtime.defaultStepTimeoutMs,
      envName: "DEFAULT_STEP_TIMEOUT_MS",
      fallback: 10 * 60 * 1000,
      min: 1_000,
      max: 24 * 60 * 60 * 1000,
    }),
    inputDownloadConcurrency: computePerfMeta({
      override: runtime.inputDownloadConcurrency,
      envName: "INPUT_DOWNLOAD_CONCURRENCY",
      fallback: 2,
      min: 1,
      max: 10_000,
    }),
    inputDownloadTimeoutMs: computePerfMeta({
      override: runtime.inputDownloadTimeoutMs,
      envName: "INPUT_DOWNLOAD_TIMEOUT_MS",
      fallback: 60_000,
      min: 1_000,
      max: 60 * 60 * 1000,
    }),
    inputDownloadMaxBytes: computePerfMeta({
      override: runtime.inputDownloadMaxBytes,
      envName: "INPUT_DOWNLOAD_MAX_BYTES",
      fallback: 50 * 1024 * 1024,
      min: 1,
      max: 10 * 1024 * 1024 * 1024,
    }),
  } satisfies Record<string, { effective: number; source: PerfSource }>

  return ok({
    locks: { performance: perfLocked },
    performance: {
      effective: {
        globalRunConcurrency: perfMeta.globalRunConcurrency.effective,
        perRunStepConcurrency: perfMeta.perRunStepConcurrency.effective,
        defaultStepTimeoutMs: perfMeta.defaultStepTimeoutMs.effective,
        inputDownloadConcurrency: perfMeta.inputDownloadConcurrency.effective,
        inputDownloadTimeoutMs: perfMeta.inputDownloadTimeoutMs.effective,
        inputDownloadMaxBytes: perfMeta.inputDownloadMaxBytes.effective,
      },
      source: {
        globalRunConcurrency: perfMeta.globalRunConcurrency.source,
        perRunStepConcurrency: perfMeta.perRunStepConcurrency.source,
        defaultStepTimeoutMs: perfMeta.defaultStepTimeoutMs.source,
        inputDownloadConcurrency: perfMeta.inputDownloadConcurrency.source,
        inputDownloadTimeoutMs: perfMeta.inputDownloadTimeoutMs.source,
        inputDownloadMaxBytes: perfMeta.inputDownloadMaxBytes.source,
      },
    },
    settings: {
      registrationMode: updated.inst.registrationMode,
      smtpEnabled: Boolean(updated.inst.smtpEnabled),
      smtpHost: updated.inst.smtpHost ?? "",
      smtpPort: typeof updated.inst.smtpPort === "number" ? updated.inst.smtpPort : null,
      smtpSecure: Boolean(updated.inst.smtpSecure),
      smtpUsername: updated.inst.smtpUsername ?? "",
      smtpFromEmail: updated.inst.smtpFromEmail ?? "",
      smtpFromName: updated.inst.smtpFromName ?? "",
      smtpPasswordConfigured: updated.passConfigured,
      smtpPassword: smtpPassword ?? "",

      globalRunConcurrency: typeof runtime.globalRunConcurrency === "number" ? runtime.globalRunConcurrency : null,
      perRunStepConcurrency: typeof runtime.perRunStepConcurrency === "number" ? runtime.perRunStepConcurrency : null,
      defaultStepTimeoutMs: typeof runtime.defaultStepTimeoutMs === "number" ? runtime.defaultStepTimeoutMs : null,
      inputDownloadConcurrency:
        typeof runtime.inputDownloadConcurrency === "number" ? runtime.inputDownloadConcurrency : null,
      inputDownloadTimeoutMs:
        typeof runtime.inputDownloadTimeoutMs === "number" ? runtime.inputDownloadTimeoutMs : null,
      inputDownloadMaxBytes: typeof runtime.inputDownloadMaxBytes === "number" ? runtime.inputDownloadMaxBytes : null,
    },
  })
})
