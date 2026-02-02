import { z } from "zod"
import os from "node:os"

import { getAuthedUserFromRequest } from "@/lib/server/auth/session"
import { fail, ok } from "@/lib/server/http/response"
import { mark, withApiObservability } from "@/lib/server/observability"
import { prisma } from "@/lib/server/db"
import {
  EMAIL_SETTINGS_ROW_ID,
  ensureInstallationRowTx,
  getInstallation,
  INSTALLATION_ROW_ID,
} from "@/lib/server/installation"
import { normalizePublicBaseUrl } from "@/lib/shared/http/public-base-url"
import {
  SYSTEM_SECRET_KEYS,
  hasSystemSecret,
  deleteSystemSecretTx,
  hasSystemSecretTx,
  upsertSystemSecretTx,
} from "@/lib/server/settings/system-secrets"
import { readRuntimeSettingsSync, writeRuntimeSettings, type RuntimeSettings } from "@/lib/server/maia/runtime-settings"
import { parsePublicBaseUrlSettingValueJson, SYSTEM_SETTING_KEYS } from "@/lib/server/settings/system-settings"
import { zodIssues } from "@/lib/shared/http/zod"
import { isValidEmailNotificationMask, normalizeEmailNotificationMask } from "@/lib/shared/email/notification-mask"

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

  // Public base URL used for generating absolute URLs in emails/webhooks (supports optional subpath).
  // null => clear; string => set/update; undefined => unchanged
  publicBaseUrl: z.union([z.string().trim().min(1), z.null()]).optional(),

  smtpEnabled: z.boolean().optional(),
  smtpHost: z.union([z.string(), z.null()]).optional(),
  smtpPort: z.union([z.number().int().min(1).max(65535), z.null()]).optional(),
  smtpSecure: z.boolean().optional(),
  smtpUsername: z.union([z.string(), z.null()]).optional(),
  smtpFromEmail: z.union([z.string().email(), z.null()]).optional(),
  smtpFromName: z.union([z.string(), z.null()]).optional(),
  emailNotificationMask: z
    .union([z.number().int(), z.null()])
    .refine((v) => v === null || isValidEmailNotificationMask(v), "emailNotificationMask contains unknown bits")
    .optional(),

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

const smtpFromEmailSchema = z.string().trim().email()

function isValidSmtpHost(raw: unknown): boolean {
  const host = String(raw ?? "").trim()
  if (!host) return false
  if (/\s/.test(host)) return false
  if (host.toLowerCase() === "localhost") return true
  const ipv4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/
  if (ipv4.test(host)) return true
  const hostname = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i
  return hostname.test(host)
}

class SmtpConfigError extends Error {
  status: number
  code: string
  meta?: Record<string, unknown>
  constructor(params: { status: number; code: string; meta?: Record<string, unknown> }) {
    super(params.code)
    this.status = params.status
    this.code = params.code
    this.meta = params.meta
  }
}

class SystemConfigError extends Error {
  status: number
  code: string
  meta?: Record<string, unknown>
  constructor(params: { status: number; code: string; meta?: Record<string, unknown> }) {
    super(params.code)
    this.status = params.status
    this.code = params.code
    this.meta = params.meta
  }
}

function requiresPublicBaseUrl(mask: number): boolean {
  const m = Number.isFinite(mask) ? Math.max(0, Math.floor(mask)) : 0
  // Current: all email notifications are RUN_* notifications which include a link.
  return m !== 0
}

export const GET = withApiObservability(async (req: Request) => {
  const user = await getAuthedUserFromRequest(req).catch(() => null)
  if (!user) return fail({ status: 401, code: "UNAUTHORIZED" })
  if (!requireAdmin(user)) return fail({ status: 403, code: "FORBIDDEN" })

  const [inst, emailSettings, passConfigured, publicBaseUrlRow] = await Promise.all([
    getInstallation().catch(() => null),
    prisma.emailSettings
      .findUnique({
        where: { id: EMAIL_SETTINGS_ROW_ID },
        select: {
          smtpEnabled: true,
          smtpHost: true,
          smtpPort: true,
          smtpSecure: true,
          smtpUsername: true,
          smtpFromEmail: true,
          smtpFromName: true,
          smtpVerifiedAt: true,
          emailNotificationMask: true,
        },
      })
      .catch(() => null),
    hasSystemSecret({ key: SYSTEM_SECRET_KEYS.smtpPassword }).catch(() => false),
    prisma.systemSetting
      .findUnique({ where: { key: SYSTEM_SETTING_KEYS.publicBaseUrl }, select: { valueJson: true } })
      .catch(() => null),
  ])
  const publicBaseUrl = parsePublicBaseUrlSettingValueJson(publicBaseUrlRow?.valueJson) ?? ""
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
      publicBaseUrl,
      smtpEnabled: Boolean(emailSettings?.smtpEnabled ?? inst?.smtpEnabled),
      smtpHost: emailSettings?.smtpHost ?? inst?.smtpHost ?? "",
      smtpPort:
        typeof emailSettings?.smtpPort === "number"
          ? emailSettings.smtpPort
          : typeof inst?.smtpPort === "number"
            ? inst.smtpPort
            : null,
      smtpSecure: Boolean(emailSettings?.smtpSecure ?? inst?.smtpSecure),
      smtpUsername: emailSettings?.smtpUsername ?? inst?.smtpUsername ?? "",
      smtpFromEmail: emailSettings?.smtpFromEmail ?? inst?.smtpFromEmail ?? "",
      smtpFromName: emailSettings?.smtpFromName ?? inst?.smtpFromName ?? "",
      smtpPassword: "",
      smtpPasswordConfigured: passConfigured,
      smtpVerifiedAt: emailSettings?.smtpVerifiedAt ? emailSettings.smtpVerifiedAt.toISOString() : null,
      emailNotificationMask:
        typeof emailSettings?.emailNotificationMask === "number"
          ? normalizeEmailNotificationMask(emailSettings.emailNotificationMask)
          : 0,

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

  // Only enforce strict SMTP validation when the request actually touches SMTP config.
  // Otherwise, unrelated settings (e.g. Public Base URL / registration / performance) should remain editable
  // even if SMTP is currently enabled but not yet verified.
  const touchingSmtp =
    body.smtpEnabled !== undefined ||
    body.smtpHost !== undefined ||
    body.smtpPort !== undefined ||
    body.smtpSecure !== undefined ||
    body.smtpUsername !== undefined ||
    body.smtpFromEmail !== undefined ||
    body.smtpFromName !== undefined ||
    body.smtpPassword !== undefined

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

  let updated: {
    inst: {
      registrationMode: string
      publicBaseUrl: string | null
      smtpEnabled: boolean
      smtpHost: string | null
      smtpPort: number | null
      smtpSecure: boolean
      smtpUsername: string | null
      smtpFromEmail: string | null
      smtpFromName: string | null
    }
    emailSettings: {
      smtpEnabled: boolean
      smtpHost: string | null
      smtpPort: number | null
      smtpSecure: boolean
      smtpUsername: string | null
      smtpFromEmail: string | null
      smtpFromName: string | null
      smtpVerifiedAt: Date | null
      emailNotificationMask: number
    }
    passConfigured: boolean
  }

  try {
    updated = await prisma.$transaction(async (tx) => {
      // Ensure row exists even if installation record was not created yet (shouldn't happen in normal flow).
      await ensureInstallationRowTx(tx, {})

      const currentPublicBaseUrl = await tx.systemSetting
        .findUnique({
          where: { key: SYSTEM_SETTING_KEYS.publicBaseUrl },
          select: { valueJson: true },
        })
        .catch(() => null)

      const currentPublicBaseUrlNormalized = parsePublicBaseUrlSettingValueJson(currentPublicBaseUrl?.valueJson)

      const currentEmail = await tx.emailSettings
        .findUnique({
          where: { id: EMAIL_SETTINGS_ROW_ID },
          select: {
            smtpEnabled: true,
            smtpHost: true,
            smtpPort: true,
            smtpSecure: true,
            smtpUsername: true,
            smtpFromEmail: true,
            smtpFromName: true,
            smtpVerifiedAt: true,
            emailNotificationMask: true,
          },
        })
        .catch(() => null)

      const nextPublicBaseUrlNormalized = (() => {
        if (body.publicBaseUrl === undefined) return currentPublicBaseUrlNormalized
        if (body.publicBaseUrl === null) return null
        const normalized = normalizePublicBaseUrl(body.publicBaseUrl)
        if (!normalized) throw new SystemConfigError({ status: 422, code: "SYSTEM_PUBLIC_BASE_URL_INVALID" })
        return normalized
      })()

      // Compute the effective SMTP config after applying this update (required for validation).
      const nextSmtpEnabled =
        typeof body.smtpEnabled === "boolean" ? body.smtpEnabled : Boolean(currentEmail?.smtpEnabled ?? false)

      const nextSmtpHost =
        body.smtpHost === null
          ? null
          : typeof body.smtpHost === "string"
            ? body.smtpHost.trim() || null
            : (currentEmail?.smtpHost ?? null)

      const nextSmtpPort =
        body.smtpPort === null
          ? null
          : typeof body.smtpPort === "number"
            ? body.smtpPort
            : typeof currentEmail?.smtpPort === "number"
              ? currentEmail.smtpPort
              : null

      const nextSmtpSecure =
        typeof body.smtpSecure === "boolean" ? body.smtpSecure : Boolean(currentEmail?.smtpSecure ?? false)

      const nextSmtpUsername =
        body.smtpUsername === null
          ? null
          : typeof body.smtpUsername === "string"
            ? body.smtpUsername.trim() || null
            : (currentEmail?.smtpUsername ?? null)

      const nextSmtpFromEmail =
        body.smtpFromEmail === null
          ? null
          : typeof body.smtpFromEmail === "string"
            ? body.smtpFromEmail.trim() || null
            : (currentEmail?.smtpFromEmail ?? null)

      const nextSmtpFromName =
        body.smtpFromName === null
          ? null
          : typeof body.smtpFromName === "string"
            ? body.smtpFromName.trim() || null
            : (currentEmail?.smtpFromName ?? null)

      const passwordTouched = body.smtpPassword !== undefined
      const nextPasswordWillExist = await (async () => {
        if (typeof body.smtpPassword === "string") return Boolean(String(body.smtpPassword).trim())
        if (body.smtpPassword === null) return false
        return await hasSystemSecretTx(tx, { key: SYSTEM_SECRET_KEYS.smtpPassword }).catch(() => false)
      })()

      const clearVerified =
        passwordTouched ||
        (body.smtpHost !== undefined && nextSmtpHost !== (currentEmail?.smtpHost ?? null)) ||
        (body.smtpPort !== undefined &&
          nextSmtpPort !== (typeof currentEmail?.smtpPort === "number" ? currentEmail.smtpPort : null)) ||
        (body.smtpSecure !== undefined && nextSmtpSecure !== Boolean(currentEmail?.smtpSecure ?? false)) ||
        (body.smtpUsername !== undefined && nextSmtpUsername !== (currentEmail?.smtpUsername ?? null)) ||
        (body.smtpFromEmail !== undefined && nextSmtpFromEmail !== (currentEmail?.smtpFromEmail ?? null)) ||
        (body.smtpFromName !== undefined && nextSmtpFromName !== (currentEmail?.smtpFromName ?? null))

      const effectiveVerifiedAt = clearVerified ? null : (currentEmail?.smtpVerifiedAt ?? null)

      // Compute the effective email notification mask after applying this update.
      const nextEmailNotificationMask =
        typeof body.emailNotificationMask === "number"
          ? normalizeEmailNotificationMask(body.emailNotificationMask)
          : body.emailNotificationMask === null
            ? 0
            : typeof currentEmail?.emailNotificationMask === "number"
              ? normalizeEmailNotificationMask(currentEmail.emailNotificationMask)
              : 0

      // Hard block: notifications that generate absolute URLs require a configured Public Base URL.
      if (requiresPublicBaseUrl(nextEmailNotificationMask) && !nextPublicBaseUrlNormalized) {
        throw new SystemConfigError({ status: 409, code: "SYSTEM_PUBLIC_BASE_URL_REQUIRED" })
      }

      // Strict SMTP validation: only when SMTP config is being modified in this request.
      // When enabled, the config must be complete and verified.
      if (touchingSmtp && nextSmtpEnabled) {
        const missing: string[] = []
        if (!nextSmtpHost || !isValidSmtpHost(nextSmtpHost)) missing.push("smtpHost")
        if (!nextSmtpPort) missing.push("smtpPort")
        if (!nextSmtpFromEmail || !smtpFromEmailSchema.safeParse(nextSmtpFromEmail).success)
          missing.push("smtpFromEmail")
        if (!nextSmtpUsername) missing.push("smtpUsername")
        if (!nextPasswordWillExist) missing.push("smtpPassword")

        if (missing.length) {
          throw new SmtpConfigError({ status: 422, code: "SYSTEM_SMTP_INVALID_CONFIG", meta: { missing } })
        }
        if (!effectiveVerifiedAt) {
          throw new SmtpConfigError({ status: 409, code: "SYSTEM_SMTP_NOT_VERIFIED" })
        }
      }

      if (typeof body.smtpPassword === "string") {
        const trimmed = String(body.smtpPassword ?? "").trim()
        if (trimmed) await upsertSystemSecretTx(tx, { key: SYSTEM_SECRET_KEYS.smtpPassword, plaintext: trimmed })
      } else if (body.smtpPassword === null) {
        await deleteSystemSecretTx(tx, { key: SYSTEM_SECRET_KEYS.smtpPassword })
      }

      const instData: Record<string, unknown> = {}
      if (typeof body.registrationMode === "string") instData.registrationMode = body.registrationMode

      // Keep legacy Installation SMTP fields in sync for backward compatibility.
      if (typeof body.smtpEnabled === "boolean") instData.smtpEnabled = body.smtpEnabled
      if (body.smtpHost === null) instData.smtpHost = null
      else if (typeof body.smtpHost === "string") instData.smtpHost = body.smtpHost.trim() || null

      if (body.smtpPort === null) instData.smtpPort = null
      else if (typeof body.smtpPort === "number") instData.smtpPort = body.smtpPort

      if (typeof body.smtpSecure === "boolean") instData.smtpSecure = body.smtpSecure

      if (body.smtpUsername === null) instData.smtpUsername = null
      else if (typeof body.smtpUsername === "string") instData.smtpUsername = body.smtpUsername.trim() || null

      if (body.smtpFromEmail === null) instData.smtpFromEmail = null
      else if (typeof body.smtpFromEmail === "string") instData.smtpFromEmail = body.smtpFromEmail.trim() || null

      if (body.smtpFromName === null) instData.smtpFromName = null
      else if (typeof body.smtpFromName === "string") instData.smtpFromName = body.smtpFromName.trim() || null

      const emailSettingsData: Record<string, unknown> = {}
      if (typeof body.smtpEnabled === "boolean") emailSettingsData.smtpEnabled = body.smtpEnabled
      if (body.smtpHost === null) emailSettingsData.smtpHost = null
      else if (typeof body.smtpHost === "string") emailSettingsData.smtpHost = body.smtpHost.trim() || null

      if (body.smtpPort === null) emailSettingsData.smtpPort = null
      else if (typeof body.smtpPort === "number") emailSettingsData.smtpPort = body.smtpPort

      if (typeof body.smtpSecure === "boolean") emailSettingsData.smtpSecure = body.smtpSecure

      if (body.smtpUsername === null) emailSettingsData.smtpUsername = null
      else if (typeof body.smtpUsername === "string") emailSettingsData.smtpUsername = body.smtpUsername.trim() || null

      if (body.smtpFromEmail === null) emailSettingsData.smtpFromEmail = null
      else if (typeof body.smtpFromEmail === "string")
        emailSettingsData.smtpFromEmail = body.smtpFromEmail.trim() || null

      if (body.smtpFromName === null) emailSettingsData.smtpFromName = null
      else if (typeof body.smtpFromName === "string") emailSettingsData.smtpFromName = body.smtpFromName.trim() || null

      if (typeof body.emailNotificationMask === "number")
        emailSettingsData.emailNotificationMask = nextEmailNotificationMask
      else if (body.emailNotificationMask === null) emailSettingsData.emailNotificationMask = 0

      if (clearVerified) emailSettingsData.smtpVerifiedAt = null

      // Persist both EmailSettings (new) and Installation (legacy).
      const [inst, publicBaseUrlSetting, emailSettings] = await Promise.all([
        tx.installation.update({
          where: { id: INSTALLATION_ROW_ID },
          data: instData,
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
        }),
        (async () => {
          if (body.publicBaseUrl === undefined) return { publicBaseUrl: currentPublicBaseUrlNormalized }
          if (nextPublicBaseUrlNormalized === null) {
            await tx.systemSetting.delete({ where: { key: SYSTEM_SETTING_KEYS.publicBaseUrl } }).catch(() => {})
            return { publicBaseUrl: null }
          }
          await tx.systemSetting.upsert({
            where: { key: SYSTEM_SETTING_KEYS.publicBaseUrl },
            create: {
              key: SYSTEM_SETTING_KEYS.publicBaseUrl,
              valueJson: JSON.stringify(nextPublicBaseUrlNormalized),
              version: 1,
            },
            update: { valueJson: JSON.stringify(nextPublicBaseUrlNormalized), version: 1 },
            select: { key: true },
          })
          return { publicBaseUrl: nextPublicBaseUrlNormalized }
        })(),
        tx.emailSettings.upsert({
          where: { id: EMAIL_SETTINGS_ROW_ID },
          create: {
            id: EMAIL_SETTINGS_ROW_ID,
            installationId: INSTALLATION_ROW_ID,
            smtpEnabled: nextSmtpEnabled,
            smtpHost: nextSmtpHost,
            smtpPort: nextSmtpPort,
            smtpSecure: nextSmtpSecure,
            smtpUsername: nextSmtpUsername,
            smtpFromEmail: nextSmtpFromEmail,
            smtpFromName: nextSmtpFromName,
            smtpVerifiedAt: effectiveVerifiedAt,
            emailNotificationMask: nextEmailNotificationMask,
          },
          update: emailSettingsData,
          select: {
            smtpEnabled: true,
            smtpHost: true,
            smtpPort: true,
            smtpSecure: true,
            smtpUsername: true,
            smtpFromEmail: true,
            smtpFromName: true,
            smtpVerifiedAt: true,
            emailNotificationMask: true,
          },
        }),
      ])

      const passConfigured = await hasSystemSecretTx(tx, { key: SYSTEM_SECRET_KEYS.smtpPassword }).catch(() => false)
      return { inst: { ...inst, publicBaseUrl: publicBaseUrlSetting.publicBaseUrl }, emailSettings, passConfigured }
    })
  } catch (e) {
    if (e instanceof SmtpConfigError) {
      return fail({ status: e.status, code: e.code, meta: e.meta })
    }
    if (e instanceof SystemConfigError) {
      return fail({ status: e.status, code: e.code, meta: e.meta })
    }
    throw e
  }

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
      publicBaseUrl: updated.inst.publicBaseUrl ?? "",
      smtpEnabled: Boolean(updated.emailSettings.smtpEnabled),
      smtpHost: updated.emailSettings.smtpHost ?? "",
      smtpPort: typeof updated.emailSettings.smtpPort === "number" ? updated.emailSettings.smtpPort : null,
      smtpSecure: Boolean(updated.emailSettings.smtpSecure),
      smtpUsername: updated.emailSettings.smtpUsername ?? "",
      smtpFromEmail: updated.emailSettings.smtpFromEmail ?? "",
      smtpFromName: updated.emailSettings.smtpFromName ?? "",
      smtpPasswordConfigured: updated.passConfigured,
      smtpPassword: "",
      smtpVerifiedAt: updated.emailSettings.smtpVerifiedAt ? updated.emailSettings.smtpVerifiedAt.toISOString() : null,
      emailNotificationMask:
        typeof updated.emailSettings.emailNotificationMask === "number"
          ? normalizeEmailNotificationMask(updated.emailSettings.emailNotificationMask)
          : 0,

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
