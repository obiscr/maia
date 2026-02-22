import "server-only"

import { prisma } from "@/lib/server/db"
import type { OperationTargetType } from "@/lib/server/operations/operations"
import type { ErrorEnvelope } from "@/lib/shared/error-display/types"
import { buildRunErrorEnvelope } from "@/lib/shared/error-display/adapters/run"
import { buildJobErrorEnvelope } from "@/lib/shared/error-display/adapters/job"
import { buildWorkflowDepsErrorEnvelope } from "@/lib/shared/error-display/adapters/workflow-deps"
import { formatPublicIdForDisplay } from "@/lib/shared/format/id"
import { safeJsonParseObject } from "@/lib/shared/lang/safe-json"

export type ExpandedOperationTarget =
  | {
      type: "run"
      id: string
      displayId: string
      href: string
      status: string
      title: string | null
      error: ErrorEnvelope | null
    }
  | {
      type: "job"
      id: string
      displayId: string
      href: string
      status: string
      title: string | null
      error: ErrorEnvelope | null
    }
  | {
      type: "workflow"
      id: string
      displayId: string
      href: string
      status: string
      title: string | null
      error: ErrorEnvelope | null
    }
  | {
      type: "schedule"
      id: string
      displayId: string
      href: string
      status: string
      title: string | null
      error: ErrorEnvelope | null
    }
  | {
      type: "batch"
      id: string
      displayId: string
      href: string
      status: string
      title: string | null
      error: ErrorEnvelope | null
    }
  | {
      type: "runStep"
      id: string
      displayId: string
      href: string
      status: string
      title: string | null
      error: ErrorEnvelope | null
      meta: { runId: string; stepKey: string }
    }

function safeLower(s: string) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
}

function buildSimpleEnvelope(params: {
  code?: string | null
  message?: string | null
  layer: "schedule" | "batch" | "operation" | "workflow" | "system"
  metaJson?: string | null
}): ErrorEnvelope | null {
  const code = params.code ? String(params.code) : null
  const message = params.message ? String(params.message) : null
  if (!code && !message) return null
  const meta = safeJsonParseObject(params.metaJson ?? null)
  const detail = typeof meta?.detail === "string" && String(meta.detail).trim() ? String(meta.detail).trim() : null
  const cause = detail ? ({ code: "DETAIL", message: detail, layer: "system", meta } satisfies ErrorEnvelope) : null
  return {
    code: code ?? "UNKNOWN",
    message: message ?? null,
    layer: params.layer,
    meta,
    causes: cause ? [cause] : null,
  }
}

export async function expandOperationTarget(params: {
  targetType: OperationTargetType | string | null
  targetId: string | null
}): Promise<ExpandedOperationTarget | null> {
  const targetType = params.targetType ? String(params.targetType) : ""
  const targetId = params.targetId ? String(params.targetId) : ""
  if (!targetType || !targetId) return null

  if (targetType === "run") {
    const row = await prisma.run.findUnique({
      where: { publicId: safeLower(targetId) },
      select: {
        publicId: true,
        status: true,
        workflowName: true,
        failureCode: true,
        failureMessage: true,
        failureMetaJson: true,
      },
    })
    if (!row) return null
    return {
      type: "run",
      id: row.publicId,
      displayId: formatPublicIdForDisplay(row.publicId),
      href: `/runs/${encodeURIComponent(String(row.publicId))}`,
      status: String(row.status),
      title: row.workflowName ? String(row.workflowName) : null,
      error: buildRunErrorEnvelope({
        failureCode: row.failureCode,
        failureMessage: row.failureMessage,
        failureMetaJson: row.failureMetaJson,
      }),
    }
  }

  if (targetType === "job") {
    const row = await prisma.jobRun.findUnique({
      where: { publicId: safeLower(targetId) },
      select: {
        publicId: true,
        status: true,
        workflowId: true,
        lastErrorCode: true,
        lastErrorMessage: true,
        lastErrorMetaJson: true,
      },
    })
    if (!row) return null
    return {
      type: "job",
      id: row.publicId,
      displayId: formatPublicIdForDisplay(row.publicId),
      href: `/jobs/${encodeURIComponent(String(row.publicId))}`,
      status: String(row.status),
      title: row.workflowId ? `workflow:${String(row.workflowId)}` : null,
      error: buildJobErrorEnvelope({
        errorCode: row.lastErrorCode,
        errorMessage: row.lastErrorMessage,
        errorMetaJson: row.lastErrorMetaJson,
      }),
    }
  }

  if (targetType === "workflow") {
    const row = await prisma.workflow.findUnique({
      where: { publicId: safeLower(targetId) },
      select: {
        publicId: true,
        name: true,
        depsStatus: true,
        depsErrorCode: true,
        depsErrorMessage: true,
        depsErrorMetaJson: true,
      },
    })
    if (!row) return null
    return {
      type: "workflow",
      id: row.publicId,
      displayId: formatPublicIdForDisplay(row.publicId),
      href: `/workflows/${encodeURIComponent(String(row.publicId))}`,
      status: String(row.depsStatus),
      title: row.name ? String(row.name) : null,
      error: buildWorkflowDepsErrorEnvelope({
        depsErrorCode: row.depsErrorCode,
        depsErrorMessage: row.depsErrorMessage,
        depsErrorMetaJson: row.depsErrorMetaJson,
      }),
    }
  }

  if (targetType === "schedule") {
    const row = await prisma.schedule.findUnique({
      where: { publicId: safeLower(targetId) },
      select: { publicId: true, name: true, enabled: true, lastFireErrorCode: true, lastFireErrorMetaJson: true },
    })
    if (!row) return null
    return {
      type: "schedule",
      id: row.publicId,
      displayId: formatPublicIdForDisplay(row.publicId),
      href: `/schedules/${encodeURIComponent(String(row.publicId))}`,
      status: row.enabled ? "ENABLED" : "DISABLED",
      title: row.name ? String(row.name) : null,
      error: buildSimpleEnvelope({
        code: row.lastFireErrorCode,
        message: null,
        metaJson: row.lastFireErrorMetaJson,
        layer: "schedule",
      }),
    }
  }

  if (targetType === "batch") {
    const row = await prisma.batch.findUnique({
      where: { publicId: safeLower(targetId) },
      select: {
        publicId: true,
        name: true,
        status: true,
        failureCode: true,
        failureMessage: true,
        failureMetaJson: true,
      },
    })
    if (!row) return null
    return {
      type: "batch",
      id: row.publicId,
      displayId: formatPublicIdForDisplay(row.publicId),
      href: `/batches/${encodeURIComponent(String(row.publicId))}`,
      status: String(row.status),
      title: row.name ? String(row.name) : null,
      error: buildSimpleEnvelope({
        code: row.failureCode,
        message: row.failureMessage,
        metaJson: row.failureMetaJson,
        layer: "batch",
      }),
    }
  }

  if (targetType === "runStep") {
    const raw = String(targetId)
    const [runPublicIdRaw, ...rest] = raw.split(":")
    const runPublicId = safeLower(runPublicIdRaw)
    const stepKey = rest.join(":")
    if (!runPublicId || !stepKey) return null

    const run = await prisma.run.findUnique({ where: { publicId: runPublicId }, select: { id: true, publicId: true } })
    if (!run) return null

    const step = await prisma.runStep.findUnique({
      where: { runId_stepKey: { runId: run.id, stepKey } },
      select: { status: true, name: true },
    })

    return {
      type: "runStep",
      id: raw,
      displayId: `${formatPublicIdForDisplay(String(run.publicId))}:${String(stepKey)}`,
      href: `/runs/${encodeURIComponent(String(run.publicId))}`,
      status: step?.status ? String(step.status) : "UNKNOWN",
      title: step?.name ? String(step.name) : stepKey,
      error: null,
      meta: { runId: String(run.publicId), stepKey: String(stepKey) },
    }
  }

  return null
}
