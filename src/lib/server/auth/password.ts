import "server-only"

import crypto from "node:crypto"
import os from "node:os"
import fs from "node:fs"

const SCRYPT_KEYLEN = 64

function readCgroupV2MemoryMaxBytes(): number | null {
  try {
    const raw = fs.readFileSync("/sys/fs/cgroup/memory.max", "utf8").trim()
    if (!raw || raw === "max") return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

function totalMemoryBytes() {
  return readCgroupV2MemoryMaxBytes() ?? os.totalmem()
}

function readIntEnv(name: string, fallback: number) {
  const n = Number(process.env[name] ?? fallback)
  return Number.isFinite(n) ? Math.floor(n) : fallback
}

function scryptMaxMemBytes(params: { N: number; r: number; p: number }) {
  // Approx memory: 128 * r * N bytes (+ overhead). Choose a safe headroom.
  const approx = 128 * params.r * params.N
  const min = 64 * 1024 * 1024
  const envMb = readIntEnv("AUTH_PASSWORD_SCRYPT_MAXMEM_MB", 0)
  if (envMb > 0) return envMb * 1024 * 1024
  return Math.max(min, approx * 2)
}

function defaultScryptNLog2() {
  // Node's default maxmem is relatively low; N=2^15 can trip "memory limit exceeded" on some hosts.
  // Use a safer default and allow env override.
  const env = readIntEnv("AUTH_PASSWORD_SCRYPT_N_LOG2", 0)
  if (env > 0) return Math.min(20, Math.max(10, env))

  const memGiB = totalMemoryBytes() / 1024 ** 3
  if (memGiB < 1) return 13
  return 14
}

function isScryptMemoryError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.includes("memory limit exceeded")
}

function base64url(buf: Buffer) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function unbase64url(s: string) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)
  return Buffer.from(b64, "base64")
}

export function hashPassword(password: string) {
  const pw = String(password ?? "")
  if (pw.length < 8) throw new Error("Password too short")

  // Calibrated to be "ok" on typical dev machines; can be tuned later.
  const salt = crypto.randomBytes(16)
  let nLog2 = defaultScryptNLog2()
  const r = readIntEnv("AUTH_PASSWORD_SCRYPT_R", 8)
  const p = readIntEnv("AUTH_PASSWORD_SCRYPT_P", 1)

  // Retry with lower N if host/container maxmem is too low.
  while (true) {
    const N = 2 ** nLog2
    try {
      const dk = crypto.scryptSync(pw, salt, SCRYPT_KEYLEN, { N, r, p, maxmem: scryptMaxMemBytes({ N, r, p }) })
      // Format: scrypt$N$r$p$salt$hash (base64url)
      return `scrypt$${N}$${r}$${p}$${base64url(salt)}$${base64url(dk)}`
    } catch (e) {
      if (isScryptMemoryError(e) && nLog2 > 12) {
        nLog2 -= 1
        continue
      }
      throw e
    }
  }
}

export function verifyPassword(password: string, stored: string) {
  const pw = String(password ?? "")
  const raw = String(stored ?? "")

  const parts = raw.split("$")
  if (parts.length !== 6) return false
  const [alg, nStr, rStr, pStr, saltB64u, hashB64u] = parts
  if (alg !== "scrypt") return false

  const N = Number(nStr)
  const r = Number(rStr)
  const p = Number(pStr)
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false

  let salt: Buffer
  let expected: Buffer
  try {
    salt = unbase64url(saltB64u)
    expected = unbase64url(hashB64u)
  } catch {
    return false
  }

  try {
    const dk = crypto.scryptSync(pw, salt, expected.length, { N, r, p, maxmem: scryptMaxMemBytes({ N, r, p }) })
    return crypto.timingSafeEqual(dk, expected)
  } catch (e) {
    // If verification fails due to maxmem constraints, treat as invalid (and log upstream if desired).
    return false
  }
}
