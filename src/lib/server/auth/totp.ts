import "server-only"

import crypto from "node:crypto"

// Minimal RFC 6238 TOTP (SHA1) with base32 secret.
// This avoids extra dependencies while keeping the algorithm explicit.

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

function base32Encode(buf: Buffer) {
  let bits = 0
  let value = 0
  let output = ""
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return output
}

function base32Decode(s: string) {
  const clean = String(s ?? "")
    .trim()
    .toUpperCase()
    .replace(/=+$/g, "")
    .replace(/[^A-Z2-7]/g, "")

  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch)
    if (idx < 0) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

function hotp(params: { secret: Buffer; counter: number; digits: number }) {
  const buf = Buffer.alloc(8)
  buf.writeUInt32BE(0, 0)
  buf.writeUInt32BE(params.counter >>> 0, 4)

  const hmac = crypto.createHmac("sha1", params.secret).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  const mod = 10 ** params.digits
  return String(code % mod).padStart(params.digits, "0")
}

export function generateTotpSecretBase32() {
  // 20 bytes is common (160-bit).
  return base32Encode(crypto.randomBytes(20))
}

export function totpAt(params: { secretBase32: string; timeMs?: number; stepSeconds?: number; digits?: number }) {
  const secret = base32Decode(params.secretBase32)
  const step = params.stepSeconds ?? 30
  const digits = params.digits ?? 6
  const t = typeof params.timeMs === "number" ? params.timeMs : Date.now()
  const counter = Math.floor(t / 1000 / step)
  return hotp({ secret, counter, digits })
}

export function verifyTotp(params: {
  secretBase32: string
  code: string
  window?: number // +/- steps
  stepSeconds?: number
  digits?: number
  timeMs?: number
}) {
  const submitted = String(params.code ?? "").trim()
  if (!/^\d{6,8}$/.test(submitted)) return false
  const win = typeof params.window === "number" ? Math.max(0, Math.floor(params.window)) : 1
  const step = params.stepSeconds ?? 30
  const digits = params.digits ?? 6
  const t = typeof params.timeMs === "number" ? params.timeMs : Date.now()
  for (let i = -win; i <= win; i++) {
    const code = totpAt({ secretBase32: params.secretBase32, timeMs: t + i * step * 1000, stepSeconds: step, digits })
    // constant-time compare is overkill for short digits but cheap
    if (submitted.length === code.length && crypto.timingSafeEqual(Buffer.from(submitted), Buffer.from(code)))
      return true
  }
  return false
}

export function buildOtpauthUrl(params: {
  issuer: string
  accountName: string
  secretBase32: string
  digits?: number
  period?: number
}) {
  const issuer = String(params.issuer ?? "").trim() || "Maia"
  const account = String(params.accountName ?? "").trim() || "user"
  const secret = String(params.secretBase32 ?? "").trim()
  const digits = params.digits ?? 6
  const period = params.period ?? 30
  const label = encodeURIComponent(`${issuer}:${account}`)
  const q = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(digits),
    period: String(period),
  })
  return `otpauth://totp/${label}?${q.toString()}`
}
