import "server-only"

import crypto from "node:crypto"

import { prisma } from "@/lib/server/db"
import { allocatePublicId } from "@/lib/server/public-ids"
import { emitOperationEvent } from "@/lib/server/operations/realtime"
import { isPlainObject } from "@/lib/shared/lang/is-plain-object"
import type { PlainObject } from "@/lib/shared/types/plain-object"
import type { ErrorEnvelope } from "@/lib/shared/error-display/types"
import { parseErrorLayer } from "@/lib/shared/error-display/parse-error-layer"

export type OperationAction =
  | "RUN_CANCEL"
  | "RUN_FORCE_STOP"
  | "JOB_CANCEL"
  | "JOB_RESUME"
  | "SCHEDULE_RUN_NOW"
  | "RUN_STEP_RETRY"
  | "RUN_STEP_RERUN"
  | "RUN_STEP_RESTART"
  | "WORKFLOW_DEPS_INSTALL"
  | "WORKFLOW_CREATE"
  | "JOB_CREATE"
  | "SCHEDULE_CREATE"
  | "BATCH_CREATE"
  | "BATCH_FANOUT"
  | "BATCH_JOBS_CREATE"
  | "BATCH_PAUSE"
  | "BATCH_RESUME"
  | "BATCH_CANCEL"

export type OperationTargetType = "run" | "job" | "schedule" | "workflow" | "runStep" | "batch"

export type OperationCreateParams = {
  action: OperationAction
  source?: "ui" | "agent" | "mcp" | null
  scope: string
  targetType?: OperationTargetType
  targetId?: string
  requestHash: string
  idempotencyKey?: string | null
  actor?: string | null
  tenantId?: string | null
  requestId?: string | null
}

export type JsonReply = {
  status: number
  body: unknown
  headers?: Record<string, string>
}

const db = prisma

function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex")
}

export function requestHashFor(params: { method: string; path: string; bodyText?: string }) {
  const body = params.bodyText ?? ""
  return sha256(`${params.method.toUpperCase()} ${params.path}\n${body}`)
}

function safePath(req: Request) {
  try {
    return new URL(req.url).pathname
  } catch {
    return req.url
  }
}

export async function requestHashFromRequest(req: Request) {
  const method = req.method.toUpperCase()
  const path = safePath(req)
  const ct = req.headers.get("content-type") ?? ""

  // Use clone() so downstream handlers can still read the body.
  let bodyBuf: ArrayBuffer | null = null
  try {
    bodyBuf = await req.clone().arrayBuffer()
  } catch {
    bodyBuf = null
  }

  const h = crypto.createHash("sha256")
  h.update(`${method} ${path}\n${ct}\n`)
  if (bodyBuf) h.update(Buffer.from(bodyBuf))
  return h.digest("hex")
}

export function getIdempotencyKey(req: Request) {
  const raw = req.headers.get("idempotency-key") ?? req.headers.get("Idempotency-Key")
  const key = typeof raw === "string" ? raw.trim() : ""
  return key.length ? key : null
}

export async function beginOperation(params: OperationCreateParams) {
  const opId = crypto.randomUUID()
  const keyId = crypto.randomUUID()

  if (params.idempotencyKey) {
    const idempotencyKey = params.idempotencyKey

    const existing = await db.idempotencyRecord.findUnique({
      where: { scope_key: { scope: params.scope, key: idempotencyKey } },
      include: { operation: true },
    })
    if (existing) {
      const same = existing.requestHash === params.requestHash
      return {
        kind: "existing" as const,
        conflict: !same,
        operation: existing.operation,
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const pub = await allocatePublicId(tx, "operation")
      const operation = await tx.operation.create({
        data: {
          id: opId,
          publicId: pub.publicId,
          publicNumber: pub.publicNumber,
          status: "RUNNING",
          action: params.action,
          source: params.source ?? null,
          scope: params.scope,
          targetType: params.targetType ?? null,
          targetId: params.targetId ?? null,
          actor: params.actor ?? null,
          tenantId: params.tenantId ?? null,
          requestId: params.requestId ?? null,
          idempotencyKey,
          requestHash: params.requestHash,
        },
      })
      await tx.idempotencyRecord.create({
        data: {
          id: keyId,
          scope: params.scope,
          key: idempotencyKey,
          requestHash: params.requestHash,
          operationId: operation.id,
        },
      })
      return operation
    })

    void emitOperationEvent({ operationId: created.id, event: "operation_created" }).catch(() => {})
    return { kind: "created" as const, conflict: false, operation: created }
  }

  const pub = await allocatePublicId(prisma, "operation")
  const created = await db.operation.create({
    data: {
      id: opId,
      publicId: pub.publicId,
      publicNumber: pub.publicNumber,
      status: "RUNNING",
      action: params.action,
      source: params.source ?? null,
      scope: params.scope,
      targetType: params.targetType ?? null,
      targetId: params.targetId ?? null,
      actor: params.actor ?? null,
      tenantId: params.tenantId ?? null,
      requestId: params.requestId ?? null,
      requestHash: params.requestHash,
    },
  })

  void emitOperationEvent({ operationId: created.id, event: "operation_created" }).catch(() => {})
  return { kind: "created" as const, conflict: false, operation: created }
}

export async function storeOperationResponse(params: { operationId: string; reply: JsonReply; error?: unknown }) {
  const body = params.reply.body ?? null
  const b = isPlainObject(body) ? (body as PlainObject) : null
  const bodyCode = typeof b?.code === "string" ? String(b.code) : null
  const bodyDetail =
    typeof (b?.meta && isPlainObject(b.meta) ? (b.meta as PlainObject).detail : undefined) === "string"
      ? String((b!.meta as PlainObject).detail ?? "")
      : typeof b?.message === "string"
        ? String(b.message)
        : null

  const thrownMessage =
    params.error == null ? null : params.error instanceof Error ? params.error.message : String(params.error)

  function inferCodeFromMessage(msg: string) {
    const s = String(msg ?? "").trim()
    if (!s) return "ERROR"
    if (/^docker create failed:/i.test(s)) return "DOCKER_CREATE_FAILED"
    if (/^docker start failed:/i.test(s)) return "DOCKER_START_FAILED"
    if (/^runner .*failed/i.test(s)) return "RUNNER_EXEC_FAILED"
    if (/^pnpm spawn failed/i.test(s)) return "PNPM_SPAWN_FAILED"
    if (/^pnpm install failed/i.test(s)) return "PNPM_INSTALL_FAILED"
    return "ERROR"
  }

  function toEnvelope(err: unknown): ErrorEnvelope | null {
    if (!err) return null
    // If the error already looks like an ErrorEnvelope, trust it.
    if (isPlainObject(err)) {
      const e = err as PlainObject
      const codeRaw = e.code
      if (typeof codeRaw === "string") {
        const code = String(codeRaw)
        const message = typeof e.message === "string" ? String(e.message) : null
        const layer = parseErrorLayer(e.layer) ?? "system"
        const meta = isPlainObject(e.meta) ? (e.meta as Record<string, unknown>) : null
        const causesRaw = Array.isArray(e.causes) ? (e.causes as unknown[]) : null
        const causes = causesRaw ? (causesRaw.map(toEnvelope).filter(Boolean) as ErrorEnvelope[]) : null
        return { code, message, layer, meta, causes: causes && causes.length ? causes : null }
      }
    }

    if (err instanceof Error) {
      const msg = String(err.message ?? "").trim()
      const env: ErrorEnvelope = {
        code: inferCodeFromMessage(msg || err.name || "ERROR"),
        message: msg || null,
        layer: "system",
        meta: isPlainObject((err as unknown as { __maiaDepsMeta?: unknown }).__maiaDepsMeta)
          ? ((err as unknown as { __maiaDepsMeta?: unknown }).__maiaDepsMeta as Record<string, unknown>)
          : null,
        causes: null,
      }
      const c = (err as unknown as { cause?: unknown }).cause
      const cEnv = c ? toEnvelope(c) : null
      if (cEnv) env.causes = [cEnv]
      return env
    }

    const s = String(err)
    return { code: inferCodeFromMessage(s), message: s, layer: "system", meta: null, causes: null }
  }

  const thrownEnv = params.error != null ? toEnvelope(params.error) : null

  // Convention:
  // - 202 => accepted but still running (do not set completedAt)
  // - 2xx/3xx (except 202) => succeeded + completedAt
  // - 4xx/5xx => failed + completedAt
  const isAccepted = params.reply.status === 202
  const isOk = params.reply.status >= 200 && params.reply.status < 400
  const status = isAccepted ? "RUNNING" : isOk ? "SUCCEEDED" : "FAILED"
  const shouldClearError = status === "SUCCEEDED" || status === "RUNNING"

  const errorCode = shouldClearError ? null : bodyCode
  const rawErrorMessage = shouldClearError ? null : (bodyDetail ?? thrownMessage)
  // Avoid redundant "CODE: CODE" UX; treat identical message as absent.
  const errorMessage =
    rawErrorMessage && errorCode && String(rawErrorMessage).trim() === String(errorCode).trim() ? null : rawErrorMessage

  // Persist a structured error envelope (wrapper → root cause) for better UX in the Operation detail page.
  const errJson = shouldClearError
    ? null
    : JSON.stringify(
        {
          code: errorCode ?? "UNKNOWN",
          message: rawErrorMessage ?? null,
          layer: "operation",
          meta: null,
          causes: thrownEnv ? [thrownEnv] : null,
        } satisfies ErrorEnvelope,
        null,
        2,
      )

  await db.operation.update({
    where: { id: params.operationId },
    data: {
      status,
      responseStatus: params.reply.status,
      responseJson: JSON.stringify(params.reply.body ?? null),
      responseHeadersJson: JSON.stringify(params.reply.headers ?? {}),
      errorCode,
      errorMessage,
      errorJson: errJson,
      completedAt: isAccepted ? null : new Date(),
    },
  })

  void emitOperationEvent({
    operationId: params.operationId,
    event: isAccepted ? "operation_progress" : "operation_completed",
  }).catch(() => {})
}

export async function setOperationProgress(params: {
  operationId: string
  current?: number
  total?: number | null
  messageKey?: string | null
  messageParams?: Record<string, string | number> | null
}) {
  const data: {
    progressCurrent?: number
    progressTotal?: number | null
    progressMessageKey?: string | null
    progressMessageParamsJson?: string | null
  } = {}
  if (typeof params.current === "number" && Number.isFinite(params.current))
    data.progressCurrent = Math.max(0, Math.floor(params.current))
  if (params.total === null) data.progressTotal = null
  if (typeof params.total === "number" && Number.isFinite(params.total))
    data.progressTotal = Math.max(0, Math.floor(params.total))
  if (params.messageKey === null) data.progressMessageKey = null
  if (typeof params.messageKey === "string") data.progressMessageKey = params.messageKey
  if (params.messageParams === null) data.progressMessageParamsJson = null
  if (params.messageParams && typeof params.messageParams === "object") {
    try {
      data.progressMessageParamsJson = JSON.stringify(params.messageParams)
    } catch {
      // ignore invalid params
    }
  }
  if (!Object.keys(data).length) return
  await db.operation.update({ where: { id: params.operationId }, data })

  void emitOperationEvent({ operationId: params.operationId, event: "operation_progress" }).catch(() => {})
}

export function parseStoredReply(op: unknown) {
  if (!isPlainObject(op)) return null
  const responseStatus = op.responseStatus
  const responseJson = op.responseJson
  const responseHeadersJson = op.responseHeadersJson
  if (typeof responseStatus !== "number" || !Number.isFinite(responseStatus)) return null
  let body: unknown = null
  let headers: Record<string, string> = {}
  try {
    body = typeof responseJson === "string" && responseJson ? JSON.parse(responseJson) : null
  } catch {
    body = null
  }
  try {
    const parsed = typeof responseHeadersJson === "string" && responseHeadersJson ? JSON.parse(responseHeadersJson) : {}
    if (isPlainObject(parsed)) {
      headers = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]))
    } else {
      headers = {}
    }
  } catch {
    headers = {}
  }
  return { status: responseStatus, body, headers } satisfies JsonReply
}
