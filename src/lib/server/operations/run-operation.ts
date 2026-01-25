import "server-only"

import { fail, ok } from "@/lib/server/http/response"
import {
  beginOperation,
  getIdempotencyKey,
  parseStoredReply,
  requestHashFromRequest,
  storeOperationResponse,
  type JsonReply,
  type OperationAction,
  type OperationTargetType,
} from "@/lib/server/operations/operations"
import { isPlainObject } from "@/lib/shared/lang/is-plain-object"
import { getRequestAuth } from "@/lib/server/observability/request-store"

function readHeader(req: Request, name: string) {
  const v = req.headers.get(name) ?? req.headers.get(name.toLowerCase()) ?? req.headers.get(name.toUpperCase())
  const s = typeof v === "string" ? v.trim() : ""
  return s.length ? s : null
}

function getAuditContextFromRequest(req: Request) {
  // Convention:
  // - requestId: prefer upstream correlation IDs if present
  // - actor: MUST come from the authenticated session (never trust client headers)
  const requestId =
    readHeader(req, "X-Request-Id") ?? readHeader(req, "X-Correlation-Id") ?? readHeader(req, "X-Amzn-Trace-Id")
  const auth = getRequestAuth()
  const actor = auth?.publicId ? `user:${auth.publicId}` : null
  return { requestId, tenantId: null, actor }
}

export async function runIdempotentOperation(params: {
  req: Request
  action: OperationAction
  scope: string
  targetType?: OperationTargetType
  targetId?: string
  defaultAcceptedStatus?: number // defaults to 202
  exec: (ctx: { operationId: string; operationInternalId: string }) => Promise<JsonReply>
}) {
  const idempotencyKey = getIdempotencyKey(params.req)
  const requestHash = await requestHashFromRequest(params.req)
  const audit = getAuditContextFromRequest(params.req)

  const started = await beginOperation({
    action: params.action,
    scope: params.scope,
    targetType: params.targetType,
    targetId: params.targetId,
    requestHash,
    idempotencyKey,
    requestId: audit.requestId,
    tenantId: audit.tenantId,
    actor: audit.actor,
  })

  if (started.conflict) {
    // Same (scope,key) but different request hash => client bug; must pick a new Idempotency-Key.
    const reply = { status: 409, body: { code: "IDEMPOTENCY_KEY_REUSED" } }
    // best-effort persist; if existing op is not ours, we don't overwrite it.
    return fail({ status: reply.status, code: "IDEMPOTENCY_KEY_REUSED" })
  }

  const existing = started.kind === "existing" ? started.operation : null
  if (existing) {
    const stored = parseStoredReply(existing)
    if (stored) {
      // Replay exact response (status/body/headers).
      if (stored.status >= 400) {
        const b = isPlainObject(stored.body) ? stored.body : null
        const code = typeof b?.code === "string" ? String(b.code) : "REQUEST_FAILED"
        const issues = Array.isArray(b?.issues) ? b.issues : undefined
        const meta = isPlainObject(b?.meta) ? (b!.meta as Record<string, unknown>) : undefined
        return fail({
          status: stored.status,
          code,
          issues,
          meta,
          headers: { ...(stored.headers ?? undefined), "X-Idempotent-Replay": "true" },
        })
      }
      return ok(stored.body, {
        status: stored.status,
        headers: { ...(stored.headers ?? undefined), "X-Idempotent-Replay": "true" },
      })
    }
    // Operation exists but no stored response yet (still running).
    const existingPublicId = String(existing.publicId ?? existing.id)
    return ok(
      { ok: true, operationId: existingPublicId },
      { status: params.defaultAcceptedStatus ?? 202, headers: { "X-Idempotent-Replay": "true" } },
    )
  }

  const operationInternalId = started.operation.id
  const operationId = String(started.operation.publicId ?? operationInternalId)

  let reply: JsonReply | null = null
  let err: unknown = null
  try {
    reply = await params.exec({ operationId, operationInternalId })
  } catch (e) {
    err = e
    reply = { status: 500, body: { code: "INTERNAL_SERVER_ERROR" } }
  }

  // Normalize the final JSON response body that we will BOTH:
  // - return to the client, and
  // - persist for idempotent replay / polling.
  const normalized = (() => {
    const baseBody = reply?.body
    const status = reply?.status ?? 500
    const headers = reply?.headers

    if (status >= 400) {
      const b = isPlainObject(baseBody) ? baseBody : null
      const code = typeof b?.code === "string" ? String(b.code) : "REQUEST_FAILED"
      const issues = Array.isArray(b?.issues) ? b.issues : undefined
      const metaIn = isPlainObject(b?.meta) ? (b!.meta as Record<string, unknown>) : undefined
      const meta = metaIn ? { ...metaIn, operationId } : { operationId }
      return { status, headers, body: { code, issues, meta } } satisfies JsonReply
    }

    const body = isPlainObject(baseBody) && baseBody.operationId == null ? { ...baseBody, operationId } : baseBody
    return { status, headers, body } satisfies JsonReply
  })()

  try {
    await storeOperationResponse({ operationId: operationInternalId, reply: normalized, error: err })
  } catch {
    // don't block response
  }

  if (normalized.status >= 400) {
    const b = isPlainObject(normalized.body) ? normalized.body : null
    const code = typeof b?.code === "string" ? String(b.code) : "REQUEST_FAILED"
    const issues = Array.isArray(b?.issues) ? b.issues : undefined
    const meta = isPlainObject(b?.meta) ? (b!.meta as Record<string, unknown>) : undefined
    return fail({ status: normalized.status, code, issues, meta })
  }

  return ok(normalized.body, { status: normalized.status, headers: normalized.headers })
}
