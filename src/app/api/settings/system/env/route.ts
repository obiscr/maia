import { getAuthedUserFromRequest } from "@/lib/server/auth/session"
import { fail, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"

export const runtime = "nodejs"

type EnvVarSource = "env" | "default" | "invalid_env"

export type EnvVarInfo = {
  name: string
  defaultValue?: string
  source: EnvVarSource
  // Present when non-sensitive.
  effectiveValue?: string
  // Present when env is set but we don't want to reveal it.
  isSet?: boolean
}

function isEnvSet(name: string) {
  const raw = process.env[name]
  if (raw == null) return false
  return String(raw).trim().length > 0
}

function readPositiveIntEnv(params: { name: string; fallback: number }) {
  const raw = process.env[params.name]
  const trimmed = String(raw ?? "").trim()
  if (!trimmed) return { source: "default" as const, value: params.fallback }
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n <= 0) return { source: "invalid_env" as const, value: params.fallback }
  return { source: "env" as const, value: Math.floor(n) }
}

function readFiniteIntEnv(params: { name: string; fallback: number }) {
  const raw = process.env[params.name]
  const trimmed = String(raw ?? "").trim()
  if (!trimmed) return { source: "default" as const, value: params.fallback }
  const n = Number(trimmed)
  if (!Number.isFinite(n)) return { source: "invalid_env" as const, value: params.fallback }
  return { source: "env" as const, value: Math.floor(n) }
}

function readStringEnv(params: { name: string; fallback: string }) {
  const raw = process.env[params.name]
  const trimmed = String(raw ?? "").trim()
  if (!trimmed) return { source: "default" as const, value: params.fallback }
  return { source: "env" as const, value: trimmed }
}

function requireAdmin(user: { role: string }) {
  return String(user.role) === "ADMIN"
}

export const GET = withApiObservability(async (req: Request) => {
  const user = await getAuthedUserFromRequest(req).catch(() => null)
  if (!user) return fail({ status: 401, code: "UNAUTHORIZED" })
  if (!requireAdmin(user)) return fail({ status: 403, code: "FORBIDDEN" })

  const vars: EnvVarInfo[] = []

  // Runtime / storage / runner
  vars.push({
    name: "RUNNER_TOKEN",
    defaultValue: "",
    source: isEnvSet("RUNNER_TOKEN") ? "env" : "default",
    isSet: isEnvSet("RUNNER_TOKEN"),
  })

  vars.push({
    name: "SETTINGS_ENCRYPTION_KEY",
    defaultValue: "",
    source: isEnvSet("SETTINGS_ENCRYPTION_KEY") ? "env" : "default",
    isSet: isEnvSet("SETTINGS_ENCRYPTION_KEY"),
  })

  {
    const v = readStringEnv({ name: "MAIA_DATA_MOUNT_TYPE", fallback: "volume" })
    vars.push({
      name: "MAIA_DATA_MOUNT_TYPE",
      defaultValue: "volume",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }
  {
    const v = readStringEnv({ name: "MAIA_HOST_DATA_DIR", fallback: "" })
    vars.push({ name: "MAIA_HOST_DATA_DIR", defaultValue: "", source: v.source, effectiveValue: String(v.value) })
  }
  {
    const v = readStringEnv({ name: "MAIA_DATA_DIR", fallback: "" })
    vars.push({ name: "MAIA_DATA_DIR", defaultValue: "", source: v.source, effectiveValue: String(v.value) })
  }
  {
    const v = readStringEnv({ name: "MAIA_RUNNER_MOUNT_MODE", fallback: "default" })
    vars.push({
      name: "MAIA_RUNNER_MOUNT_MODE",
      defaultValue: "default",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }

  // Runner knobs
  {
    const v = readFiniteIntEnv({ name: "RUNNER_DEBUG_RETAIN_FAILED", fallback: 0 })
    vars.push({
      name: "RUNNER_DEBUG_RETAIN_FAILED",
      defaultValue: "0",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }
  {
    const v = readFiniteIntEnv({ name: "RUNNER_NOFILE", fallback: 0 })
    vars.push({ name: "RUNNER_NOFILE", defaultValue: "0", source: v.source, effectiveValue: String(v.value) })
  }
  {
    const v = readStringEnv({ name: "RUNNER_DOCKER_API_VERSION", fallback: "" })
    vars.push({
      name: "RUNNER_DOCKER_API_VERSION",
      defaultValue: "",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }
  {
    const v = readStringEnv({ name: "RUNNER_DEFAULT_MOUNT_MODE", fallback: "default" })
    vars.push({
      name: "RUNNER_DEFAULT_MOUNT_MODE",
      defaultValue: "default",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }

  // Lock performance settings UI
  {
    const v = readFiniteIntEnv({ name: "SYSTEM_PERFORMANCE_LOCKED", fallback: 0 })
    vars.push({
      name: "SYSTEM_PERFORMANCE_LOCKED",
      defaultValue: "0",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }

  // Security (break-glass)
  vars.push({
    name: "SETUP_REPAIR_TOKEN",
    defaultValue: "",
    source: isEnvSet("SETUP_REPAIR_TOKEN") ? "env" : "default",
    isSet: isEnvSet("SETUP_REPAIR_TOKEN"),
  })

  // Security (rate limits) - positive ints only.
  {
    const v = readPositiveIntEnv({ name: "RATE_LIMIT_MAX_BUCKETS", fallback: 5000 })
    vars.push({
      name: "RATE_LIMIT_MAX_BUCKETS",
      defaultValue: "5000",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }
  {
    const v = readPositiveIntEnv({ name: "RATE_LIMIT_PRUNE_EVERY_MS", fallback: 10_000 })
    vars.push({
      name: "RATE_LIMIT_PRUNE_EVERY_MS",
      defaultValue: "10000",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }
  {
    const v = readPositiveIntEnv({ name: "AUTH_RATE_LIMIT_SIGNIN_WINDOW_MS", fallback: 60000 })
    vars.push({
      name: "AUTH_RATE_LIMIT_SIGNIN_WINDOW_MS",
      defaultValue: "60000",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }
  {
    const v = readPositiveIntEnv({ name: "AUTH_RATE_LIMIT_SIGNIN_PER_IP", fallback: 30 })
    vars.push({
      name: "AUTH_RATE_LIMIT_SIGNIN_PER_IP",
      defaultValue: "30",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }
  {
    const v = readPositiveIntEnv({ name: "AUTH_RATE_LIMIT_SIGNIN_PER_IP_EMAIL", fallback: 10 })
    vars.push({
      name: "AUTH_RATE_LIMIT_SIGNIN_PER_IP_EMAIL",
      defaultValue: "10",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }
  {
    const v = readPositiveIntEnv({ name: "AUTH_RATE_LIMIT_SIGNUP_WINDOW_MS", fallback: 60000 })
    vars.push({
      name: "AUTH_RATE_LIMIT_SIGNUP_WINDOW_MS",
      defaultValue: "60000",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }
  {
    const v = readPositiveIntEnv({ name: "AUTH_RATE_LIMIT_SIGNUP_PER_IP", fallback: 10 })
    vars.push({
      name: "AUTH_RATE_LIMIT_SIGNUP_PER_IP",
      defaultValue: "10",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }
  {
    const v = readPositiveIntEnv({ name: "AUTH_RATE_LIMIT_PASSWORD_FORGOT_WINDOW_MS", fallback: 60000 })
    vars.push({
      name: "AUTH_RATE_LIMIT_PASSWORD_FORGOT_WINDOW_MS",
      defaultValue: "60000",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }
  {
    const v = readPositiveIntEnv({ name: "AUTH_RATE_LIMIT_PASSWORD_FORGOT_PER_IP", fallback: 10 })
    vars.push({
      name: "AUTH_RATE_LIMIT_PASSWORD_FORGOT_PER_IP",
      defaultValue: "10",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }
  {
    const v = readPositiveIntEnv({ name: "AUTH_RATE_LIMIT_PASSWORD_FORGOT_PER_IP_EMAIL", fallback: 5 })
    vars.push({
      name: "AUTH_RATE_LIMIT_PASSWORD_FORGOT_PER_IP_EMAIL",
      defaultValue: "5",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }
  {
    const v = readPositiveIntEnv({ name: "AUTH_RATE_LIMIT_MAGIC_LINK_REQUEST_WINDOW_MS", fallback: 60000 })
    vars.push({
      name: "AUTH_RATE_LIMIT_MAGIC_LINK_REQUEST_WINDOW_MS",
      defaultValue: "60000",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }
  {
    const v = readPositiveIntEnv({ name: "AUTH_RATE_LIMIT_MAGIC_LINK_REQUEST_PER_IP", fallback: 10 })
    vars.push({
      name: "AUTH_RATE_LIMIT_MAGIC_LINK_REQUEST_PER_IP",
      defaultValue: "10",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }
  {
    const v = readPositiveIntEnv({ name: "AUTH_RATE_LIMIT_MAGIC_LINK_REQUEST_PER_IP_EMAIL", fallback: 5 })
    vars.push({
      name: "AUTH_RATE_LIMIT_MAGIC_LINK_REQUEST_PER_IP_EMAIL",
      defaultValue: "5",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }
  {
    const v = readPositiveIntEnv({ name: "AUTH_RATE_LIMIT_EMAIL_OTP_REQUEST_WINDOW_MS", fallback: 60000 })
    vars.push({
      name: "AUTH_RATE_LIMIT_EMAIL_OTP_REQUEST_WINDOW_MS",
      defaultValue: "60000",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }
  {
    const v = readPositiveIntEnv({ name: "AUTH_RATE_LIMIT_EMAIL_OTP_REQUEST_PER_IP", fallback: 10 })
    vars.push({
      name: "AUTH_RATE_LIMIT_EMAIL_OTP_REQUEST_PER_IP",
      defaultValue: "10",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }
  {
    const v = readPositiveIntEnv({ name: "AUTH_RATE_LIMIT_EMAIL_OTP_REQUEST_PER_IP_EMAIL", fallback: 5 })
    vars.push({
      name: "AUTH_RATE_LIMIT_EMAIL_OTP_REQUEST_PER_IP_EMAIL",
      defaultValue: "5",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }
  {
    const v = readPositiveIntEnv({ name: "AUTH_RATE_LIMIT_EMAIL_OTP_VERIFY_WINDOW_MS", fallback: 60000 })
    vars.push({
      name: "AUTH_RATE_LIMIT_EMAIL_OTP_VERIFY_WINDOW_MS",
      defaultValue: "60000",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }
  {
    const v = readPositiveIntEnv({ name: "AUTH_RATE_LIMIT_EMAIL_OTP_VERIFY_PER_IP", fallback: 30 })
    vars.push({
      name: "AUTH_RATE_LIMIT_EMAIL_OTP_VERIFY_PER_IP",
      defaultValue: "30",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }
  {
    const v = readPositiveIntEnv({ name: "AUTH_RATE_LIMIT_EMAIL_OTP_VERIFY_PER_IP_EMAIL", fallback: 10 })
    vars.push({
      name: "AUTH_RATE_LIMIT_EMAIL_OTP_VERIFY_PER_IP_EMAIL",
      defaultValue: "10",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }
  {
    const v = readPositiveIntEnv({ name: "AUTH_RATE_LIMIT_CHALLENGE_WINDOW_MS", fallback: 60000 })
    vars.push({
      name: "AUTH_RATE_LIMIT_CHALLENGE_WINDOW_MS",
      defaultValue: "60000",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }
  {
    const v = readPositiveIntEnv({ name: "AUTH_RATE_LIMIT_CHALLENGE_PER_IP", fallback: 30 })
    vars.push({
      name: "AUTH_RATE_LIMIT_CHALLENGE_PER_IP",
      defaultValue: "30",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }
  {
    const v = readPositiveIntEnv({ name: "AUTH_RATE_LIMIT_SETUP_WINDOW_MS", fallback: 60 * 60_000 })
    vars.push({
      name: "AUTH_RATE_LIMIT_SETUP_WINDOW_MS",
      defaultValue: "3600000",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }
  {
    const v = readPositiveIntEnv({ name: "AUTH_RATE_LIMIT_SETUP_PER_IP", fallback: 10 })
    vars.push({
      name: "AUTH_RATE_LIMIT_SETUP_PER_IP",
      defaultValue: "10",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }

  // Security (scrypt) - numeric ints; some values are clamped/auto-tuned at runtime.
  // We keep this view conservative: if env is set and parseable, show env value; otherwise show documented defaults.
  {
    const v = readPositiveIntEnv({ name: "AUTH_PASSWORD_SCRYPT_N_LOG2", fallback: 14 })
    vars.push({
      name: "AUTH_PASSWORD_SCRYPT_N_LOG2",
      defaultValue: "14",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }
  {
    const v = readFiniteIntEnv({ name: "AUTH_PASSWORD_SCRYPT_R", fallback: 8 })
    vars.push({ name: "AUTH_PASSWORD_SCRYPT_R", defaultValue: "8", source: v.source, effectiveValue: String(v.value) })
  }
  {
    const v = readFiniteIntEnv({ name: "AUTH_PASSWORD_SCRYPT_P", fallback: 1 })
    vars.push({ name: "AUTH_PASSWORD_SCRYPT_P", defaultValue: "1", source: v.source, effectiveValue: String(v.value) })
  }
  {
    const v = readFiniteIntEnv({ name: "AUTH_PASSWORD_SCRYPT_MAXMEM_MB", fallback: 128 })
    vars.push({
      name: "AUTH_PASSWORD_SCRYPT_MAXMEM_MB",
      defaultValue: "128",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }

  // Retention / cleanup - positive ints.
  {
    const v = readPositiveIntEnv({ name: "OPS_CLEANUP_EVERY_MINUTES", fallback: 60 })
    vars.push({
      name: "OPS_CLEANUP_EVERY_MINUTES",
      defaultValue: "60",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }
  {
    const v = readPositiveIntEnv({ name: "OPS_TTL_DAYS", fallback: 30 })
    vars.push({ name: "OPS_TTL_DAYS", defaultValue: "30", source: v.source, effectiveValue: String(v.value) })
  }
  {
    const v = readPositiveIntEnv({ name: "IDEMPOTENCY_TTL_DAYS", fallback: 7 })
    vars.push({ name: "IDEMPOTENCY_TTL_DAYS", defaultValue: "7", source: v.source, effectiveValue: String(v.value) })
  }
  {
    const v = readPositiveIntEnv({ name: "OPS_RUNNING_MAX_AGE_DAYS", fallback: 2 })
    vars.push({
      name: "OPS_RUNNING_MAX_AGE_DAYS",
      defaultValue: "2",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }
  {
    const v = readPositiveIntEnv({ name: "OPS_OPERATION_HEARTBEAT_MS", fallback: 30000 })
    vars.push({
      name: "OPS_OPERATION_HEARTBEAT_MS",
      defaultValue: "30000",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }
  {
    const v = readPositiveIntEnv({ name: "OPS_CLEANUP_ENGINE_TICK_MS", fallback: 30000 })
    vars.push({
      name: "OPS_CLEANUP_ENGINE_TICK_MS",
      defaultValue: "30000",
      source: v.source,
      effectiveValue: String(v.value),
    })
  }

  return ok({ vars })
})
