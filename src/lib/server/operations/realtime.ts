import "server-only"

import { prisma } from "@/lib/server/db"
import { appendStreamEvent } from "@/lib/server/realtime/store"
import { makeAdminListStreamTopic, makeStreamTopic, makeUserListStreamTopic } from "@/lib/shared/realtime/topics"

export type OperationRealtimeState = {
  operationId: string
  status: string
  action: string
  source?: string | null
  scope?: string | null
  targetType?: string | null
  targetId?: string | null
  actor?: string | null
  tenantId?: string | null
  requestId?: string | null
  progressCurrent?: number | null
  progressTotal?: number | null
  progressMessageKey?: string | null
  progressMessageParams?: Record<string, string | number> | null
  responseStatus?: number | null
  errorCode?: string | null
  errorMessage?: string | null
  completedAt?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

export type OperationRealtimeEventType = "operation_created" | "operation_progress" | "operation_completed"

export async function emitOperationEvent(params: { operationId: string; event: OperationRealtimeEventType }) {
  const operationId = params.operationId
  if (!operationId) return
  const op = await prisma.operation.findUnique({
    where: { id: operationId },
    select: {
      id: true,
      publicId: true,
      publicNumber: true,
      status: true,
      action: true,
      source: true,
      scope: true,
      targetType: true,
      targetId: true,
      actor: true,
      tenantId: true,
      requestId: true,
      progressCurrent: true,
      progressTotal: true,
      progressMessageKey: true,
      progressMessageParamsJson: true,
      responseStatus: true,
      errorCode: true,
      errorMessage: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  if (!op) return

  const progressParams = (() => {
    const raw = op.progressMessageParamsJson
    if (typeof raw !== "string" || !raw.trim()) return null
    try {
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
      const out: Record<string, string | number> = {}
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "string" || typeof v === "number") out[k] = v
      }
      return Object.keys(out).length ? out : null
    } catch {
      return null
    }
  })()

  const state: OperationRealtimeState = {
    operationId: String(op.publicId ?? op.id),
    status: String(op.status),
    action: String(op.action),
    source: op.source ? String(op.source) : null,
    scope: op.scope ? String(op.scope) : null,
    targetType: op.targetType ? String(op.targetType) : null,
    targetId: op.targetId ? String(op.targetId) : null,
    actor: op.actor ? String(op.actor) : null,
    tenantId: op.tenantId ? String(op.tenantId) : null,
    requestId: op.requestId ? String(op.requestId) : null,
    progressCurrent: typeof op.progressCurrent === "number" ? op.progressCurrent : 0,
    progressTotal: typeof op.progressTotal === "number" ? op.progressTotal : null,
    progressMessageKey: op.progressMessageKey ? String(op.progressMessageKey) : null,
    progressMessageParams: progressParams,
    responseStatus: typeof op.responseStatus === "number" ? op.responseStatus : null,
    errorCode: op.errorCode ? String(op.errorCode) : null,
    errorMessage: op.errorMessage ? String(op.errorMessage) : null,
    completedAt: op.completedAt ? op.completedAt.toISOString() : null,
    createdAt: op.createdAt ? op.createdAt.toISOString() : null,
    updatedAt: op.updatedAt ? op.updatedAt.toISOString() : null,
  }

  // Admin list topic: can see all.
  await appendStreamEvent({ topic: makeAdminListStreamTopic("operations"), event: params.event, data: state })

  // Per-user list topic: derived from actor `user:<publicId>`.
  const actor = String(state.actor ?? "")
  const userPublicId = actor.startsWith("user:") ? actor.slice("user:".length).trim() : ""
  if (userPublicId) {
    await appendStreamEvent({
      topic: makeUserListStreamTopic("operations", userPublicId),
      event: params.event,
      data: state,
    })
  }
  await appendStreamEvent({
    topic: makeStreamTopic("operation", state.operationId),
    event: params.event,
    data: state,
  })
}
