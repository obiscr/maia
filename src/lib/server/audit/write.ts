import "server-only"

export type AuditAuthContext = {
  userId: string
}

export function makeCreateAudit(auth: AuditAuthContext) {
  return {
    ownerUserId: auth.userId,
    createdByUserId: auth.userId,
    updatedByUserId: auth.userId,
    triggeredByUserId: auth.userId,
  }
}

export function makeUpdateAudit(auth: AuditAuthContext) {
  return {
    updatedByUserId: auth.userId,
    triggeredByUserId: auth.userId,
  }
}
