import "server-only"

import net from "node:net"

type Bucket = {
  resetAtMs: number
  count: number
  lastSeenAtMs: number
}

declare global {
  // Persist across dev HMR.
  // eslint-disable-next-line no-var
  var __maiaRateLimitBuckets: Map<string, Bucket> | undefined
  // eslint-disable-next-line no-var
  var __maiaRateLimitLastPruneAtMs: number | undefined
}

function readIntEnv(name: string, fallback: number) {
  const raw = Number(process.env[name] ?? fallback)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback
}

export const RATE_LIMIT_CONFIG = {
  maxBuckets: readIntEnv("RATE_LIMIT_MAX_BUCKETS", 5000),
  pruneEveryMs: readIntEnv("RATE_LIMIT_PRUNE_EVERY_MS", 10_000),
  // Auth defaults (local-first safe baseline; can be tuned for self-hosted setups).
  authSigninWindowMs: readIntEnv("AUTH_RATE_LIMIT_SIGNIN_WINDOW_MS", 60_000),
  authSigninPerIpLimit: readIntEnv("AUTH_RATE_LIMIT_SIGNIN_PER_IP", 30),
  authSigninPerIpEmailLimit: readIntEnv("AUTH_RATE_LIMIT_SIGNIN_PER_IP_EMAIL", 10),
  authSignupWindowMs: readIntEnv("AUTH_RATE_LIMIT_SIGNUP_WINDOW_MS", 60_000),
  authSignupPerIpLimit: readIntEnv("AUTH_RATE_LIMIT_SIGNUP_PER_IP", 10),
  authPasswordForgotWindowMs: readIntEnv("AUTH_RATE_LIMIT_PASSWORD_FORGOT_WINDOW_MS", 60_000),
  authPasswordForgotPerIpLimit: readIntEnv("AUTH_RATE_LIMIT_PASSWORD_FORGOT_PER_IP", 10),
  authPasswordForgotPerIpEmailLimit: readIntEnv("AUTH_RATE_LIMIT_PASSWORD_FORGOT_PER_IP_EMAIL", 5),
  authMagicLinkRequestWindowMs: readIntEnv("AUTH_RATE_LIMIT_MAGIC_LINK_REQUEST_WINDOW_MS", 60_000),
  authMagicLinkRequestPerIpLimit: readIntEnv("AUTH_RATE_LIMIT_MAGIC_LINK_REQUEST_PER_IP", 10),
  authMagicLinkRequestPerIpEmailLimit: readIntEnv("AUTH_RATE_LIMIT_MAGIC_LINK_REQUEST_PER_IP_EMAIL", 5),
  authEmailOtpRequestWindowMs: readIntEnv("AUTH_RATE_LIMIT_EMAIL_OTP_REQUEST_WINDOW_MS", 60_000),
  authEmailOtpRequestPerIpLimit: readIntEnv("AUTH_RATE_LIMIT_EMAIL_OTP_REQUEST_PER_IP", 10),
  authEmailOtpRequestPerIpEmailLimit: readIntEnv("AUTH_RATE_LIMIT_EMAIL_OTP_REQUEST_PER_IP_EMAIL", 5),
  authEmailOtpVerifyWindowMs: readIntEnv("AUTH_RATE_LIMIT_EMAIL_OTP_VERIFY_WINDOW_MS", 60_000),
  authEmailOtpVerifyPerIpLimit: readIntEnv("AUTH_RATE_LIMIT_EMAIL_OTP_VERIFY_PER_IP", 30),
  authEmailOtpVerifyPerIpEmailLimit: readIntEnv("AUTH_RATE_LIMIT_EMAIL_OTP_VERIFY_PER_IP_EMAIL", 10),
  authChallengeWindowMs: readIntEnv("AUTH_RATE_LIMIT_CHALLENGE_WINDOW_MS", 60_000),
  authChallengePerIpLimit: readIntEnv("AUTH_RATE_LIMIT_CHALLENGE_PER_IP", 30),
  authSetupWindowMs: readIntEnv("AUTH_RATE_LIMIT_SETUP_WINDOW_MS", 60 * 60_000),
  authSetupPerIpLimit: readIntEnv("AUTH_RATE_LIMIT_SETUP_PER_IP", 10),
} as const

function getBuckets() {
  if (!globalThis.__maiaRateLimitBuckets) globalThis.__maiaRateLimitBuckets = new Map<string, Bucket>()
  return globalThis.__maiaRateLimitBuckets
}

function pruneBuckets(buckets: Map<string, Bucket>, now: number) {
  const last = typeof globalThis.__maiaRateLimitLastPruneAtMs === "number" ? globalThis.__maiaRateLimitLastPruneAtMs : 0
  if (now - last < RATE_LIMIT_CONFIG.pruneEveryMs) return
  globalThis.__maiaRateLimitLastPruneAtMs = now

  // Remove expired buckets first.
  for (const [k, v] of buckets.entries()) {
    if (v.resetAtMs <= now) buckets.delete(k)
  }
  // Hard cap to avoid attacker-controlled cardinality (e.g. spoofed XFF / random emails).
  while (buckets.size > RATE_LIMIT_CONFIG.maxBuckets) {
    const firstKey = buckets.keys().next().value as string | undefined
    if (!firstKey) break
    buckets.delete(firstKey)
  }
}

export function getClientIp(req: Request) {
  const raw = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? ""
  const first = String(raw).split(",")[0]?.trim() ?? ""
  if (!first) return "unknown"
  // Prevent header spoofing from exploding key cardinality: accept only valid IP literals.
  return net.isIP(first) ? first : "unknown"
}

export function checkRateLimit(params: { key: string; limit: number; windowMs: number }) {
  const key = String(params.key || "").trim()
  const limit = Math.max(1, Math.floor(params.limit))
  const windowMs = Math.max(1000, Math.floor(params.windowMs))
  const now = Date.now()

  const buckets = getBuckets()
  pruneBuckets(buckets, now)
  const cur = buckets.get(key)
  if (!cur || cur.resetAtMs <= now) {
    const next: Bucket = { resetAtMs: now + windowMs, count: 1, lastSeenAtMs: now }
    buckets.set(key, next)
    return { allowed: true as const, retryAfterMs: 0, remaining: Math.max(0, limit - 1) }
  }

  cur.count += 1
  cur.lastSeenAtMs = now
  if (cur.count <= limit) {
    buckets.set(key, cur)
    return { allowed: true as const, retryAfterMs: 0, remaining: Math.max(0, limit - cur.count) }
  }

  // Over limit: keep bucket as-is, tell caller how long to wait.
  const retryAfterMs = Math.max(0, cur.resetAtMs - now)
  return { allowed: false as const, retryAfterMs, remaining: 0 }
}
