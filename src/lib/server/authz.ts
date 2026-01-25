import "server-only"

import { getRequestAuth } from "@/lib/server/observability/request-store"
import { normalizeRole } from "@/lib/shared/viewer"

export type RequestAuthContext = {
  userId: string
  publicId: string
  role: string
}

export function requireRequestAuth(): RequestAuthContext {
  const auth = getRequestAuth()
  if (!auth) throw new Error("Missing request auth (expected withApiObservability to set it)")
  return auth
}

export function isAdmin(auth: RequestAuthContext) {
  return normalizeRole(auth.role) === "ADMIN"
}
