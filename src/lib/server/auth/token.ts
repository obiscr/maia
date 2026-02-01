import "server-only"

import crypto from "node:crypto"

export function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex")
}

export function hashOpaqueToken(token: string) {
  return sha256Hex(String(token ?? ""))
}

export function newOpaqueToken() {
  return crypto.randomBytes(32).toString("base64url")
}

export function newSalt() {
  return crypto.randomBytes(16).toString("base64url")
}

export function newOtpCode6(): string {
  const n = crypto.randomInt(0, 1_000_000)
  return String(n).padStart(6, "0")
}

export function hashOtpCode(params: { code: string; salt: string }) {
  return sha256Hex(`${String(params.code ?? "").trim()}:${String(params.salt ?? "")}`)
}
