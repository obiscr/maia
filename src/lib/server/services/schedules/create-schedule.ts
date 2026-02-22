import "server-only"

import crypto from "node:crypto"
import { z } from "zod"

import { prisma } from "@/lib/server/db"
import type { RequestAuthContext } from "@/lib/server/authz"
import type { ViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { getWorkflowFindFirstWhereById, getWorkflowFindFirstWhereByPublicId } from "@/lib/server/scopes/workflows-scope"
import { findReservedKeysInRecord, parseWorkflowInputSpecWithOpts } from "@/lib/shared/maia/input-spec"
import { validateWithJsonSchema } from "@/lib/server/maia/jsonschema"
import { workflowSnapshotSchema } from "@/lib/server/maia/snapshot"
import { getLatestWorkflowVersion } from "@/lib/server/maia/workflow-versioning"
import { normalizeUrlFilesForStorage } from "@/lib/server/maia/url-files"
import type { ApiIssue } from "@/lib/shared/http/types"
import { isRecord } from "@/lib/shared/lang/is-record"
import { allocatePublicId } from "@/lib/server/public-ids"
import { makeCreateAudit } from "@/lib/server/audit/write"
import { computeNextRunAt, validateCronExpression, type ScheduleLike } from "@/lib/server/maia/scheduler"
import { emitScheduleState } from "@/lib/server/maia/realtime"

export const createScheduleSchema = z.object({
  name: z.string().trim().max(200).optional().default(""),
  workflowId: z.string().min(1),
  kind: z.enum(["CRON", "INTERVAL"]).default("CRON"),
  cron: z.string().trim().max(200).optional().default(""),
  timezone: z.string().trim().max(64).optional().default("UTC"),
  intervalMs: z.coerce.number().int().min(1000).optional(),
  enabled: z.boolean().optional().default(true),
  misfirePolicy: z.enum(["SKIP", "FIRE_ONCE", "CATCH_UP"]).optional().default("FIRE_ONCE"),
  catchUpLimit: z.coerce.number().int().min(1).max(100).nullable().optional(),
  overlapPolicy: z.enum(["SKIP", "ALLOW"]).optional().default("SKIP"),
  pinnedWorkflowVersionNumber: z.coerce.number().int().min(1).nullable().optional(),
  inputJson: z.unknown().default({}),
  urlFiles: z
    .array(
      z.object({
        url: z.string().min(1),
        name: z.string().optional(),
        id: z.string().optional(),
      }),
    )
    .optional()
    .default([]),
})

export async function createSchedule(params: {
  auth: RequestAuthContext
  viewerAuth: ViewerAuthContext
  body: z.infer<typeof createScheduleSchema>
}) {
  const body = params.body
  if (body.kind === "CRON") {
    const expr = String(body.cron ?? "").trim()
    if (!expr) {
      return {
        ok: false as const,
        status: 422,
        code: "INVALID_CRON" as const,
        issues: [{ path: "/cron", keyword: "required", params: { missingProperty: "cron" } }],
      }
    }
    try {
      validateCronExpression(expr)
    } catch {
      return {
        ok: false as const,
        status: 422,
        code: "INVALID_CRON" as const,
        issues: [{ path: "/cron", keyword: "format", params: { format: "cron" } }],
      }
    }
  }
  const workflowPublicId = String(body.workflowId || "")
    .trim()
    .toLowerCase()
  const workflow =
    (await prisma.workflow.findFirst({
      where: getWorkflowFindFirstWhereByPublicId(params.viewerAuth, workflowPublicId),
    })) ??
    (await prisma.workflow.findFirst({
      where: getWorkflowFindFirstWhereById(params.viewerAuth, body.workflowId),
    }))
  if (!workflow) return { ok: false as const, status: 404, code: "WORKFLOW_NOT_FOUND" as const }

  let pinnedWorkflowVersionId: string | null = null
  if (body.pinnedWorkflowVersionNumber != null) {
    const ver = body.pinnedWorkflowVersionNumber
    const row = await prisma.workflowVersion.findUnique({
      where: { workflowId_version: { workflowId: workflow.id, version: ver } },
      select: { id: true },
    })
    if (!row) {
      return {
        ok: false as const,
        status: 422,
        code: "INVALID_PINNED_WORKFLOW_VERSION" as const,
        issues: [
          {
            path: "/pinnedWorkflowVersionNumber",
            keyword: "not_found",
            params: { version: ver },
          },
        ],
      }
    }
    pinnedWorkflowVersionId = row.id
  }

  const normalized = isRecord(body.inputJson) ? body.inputJson : { value: body.inputJson }
  const version = pinnedWorkflowVersionId
    ? await prisma.workflowVersion.findUnique({
        where: { id: pinnedWorkflowVersionId },
        select: { snapshotJson: true },
      })
    : await getLatestWorkflowVersion(workflow.id)
  if (!version) {
    return {
      ok: false as const,
      status: 409,
      code: "WORKFLOW_VERSION_REQUIRED" as const,
      meta: { workflowId: workflow.publicId },
    }
  }
  const snapshot = workflowSnapshotSchema.parse(JSON.parse(version?.snapshotJson || "{}"))
  const specParsed = parseWorkflowInputSpecWithOpts(snapshot.inputSpec ?? null, {
    reservedKeys: snapshot.reservedInitialInputKeys,
  })
  if (snapshot.inputSpec && !specParsed.spec) {
    return {
      ok: false as const,
      status: 500,
      code: "WORKFLOW_INPUT_SPEC_INVALID" as const,
      meta: { field: "inputSpec" },
    }
  }
  const inputSpec = specParsed.spec

  if (isRecord(normalized)) {
    const reserved = findReservedKeysInRecord(normalized, snapshot.reservedInitialInputKeys)
    if (reserved.length) {
      return {
        ok: false as const,
        status: 422,
        code: "INVALID_INPUT_JSON" as const,
        issues: reserved.map((field) => ({
          path: `/inputJson/${field}`,
          keyword: "reserved",
          params: { field },
        })),
      }
    }
  }

  if (inputSpec) {
    if (!isRecord(body.inputJson)) {
      const issues: ApiIssue[] = [{ path: "/inputJson", keyword: "type", params: { type: "object" } }]
      return { ok: false as const, status: 422, code: "INVALID_INPUT_JSON" as const, issues }
    }
    const v = validateWithJsonSchema({ schema: inputSpec.paramsSchema, data: body.inputJson })
    if (!v.ok) return { ok: false as const, status: 422, code: "INVALID_INPUT_JSON" as const, issues: v.issues }
  }

  const urlFiles = normalizeUrlFilesForStorage(body.urlFiles)
  if (inputSpec?.filesInput?.urlFiles) {
    const enabled = inputSpec.filesInput.urlFiles.enabled !== false
    if (!enabled && urlFiles.length) {
      const issues: ApiIssue[] = [{ path: "/urlFiles", keyword: "disabled", params: { field: "urlFiles" } }]
      return { ok: false as const, status: 422, code: "INVALID_INPUT_FILES" as const, issues }
    }
    if (inputSpec.filesInput.urlFiles.required && urlFiles.length === 0) {
      const issues: ApiIssue[] = [{ path: "/urlFiles", keyword: "required", params: { missingProperty: "urlFiles" } }]
      return { ok: false as const, status: 422, code: "INVALID_INPUT_FILES" as const, issues }
    }
    if (
      typeof inputSpec.filesInput.urlFiles.maxItems === "number" &&
      urlFiles.length > inputSpec.filesInput.urlFiles.maxItems
    ) {
      const issues: ApiIssue[] = [
        {
          path: "/urlFiles",
          keyword: "maxItems",
          params: { limit: inputSpec.filesInput.urlFiles.maxItems },
        },
      ]
      return {
        ok: false as const,
        status: 422,
        code: "INVALID_INPUT_FILES" as const,
        issues,
        meta: { maxItems: inputSpec.filesInput.urlFiles.maxItems },
      }
    }
  } else if (urlFiles.length) {
    const issues: ApiIssue[] = [{ path: "/urlFiles", keyword: "not_supported", params: { field: "urlFiles" } }]
    return { ok: false as const, status: 422, code: "INVALID_INPUT_FILES" as const, issues }
  }

  const schedule = await prisma.$transaction(async (tx) => {
    const pub = await allocatePublicId(tx, "schedule")
    const created = await tx.schedule.create({
      data: {
        id: crypto.randomUUID(),
        publicId: pub.publicId,
        publicNumber: pub.publicNumber,
        name: body.name?.trim() ? body.name.trim() : null,
        enabled: body.enabled,
        workflowId: workflow.id,
        ...makeCreateAudit(params.auth),
        pinnedWorkflowVersionId,
        kind: body.kind,
        cron: body.kind === "CRON" ? (body.cron?.trim() ? body.cron.trim() : null) : null,
        timezone: body.timezone?.trim() ? body.timezone.trim() : "UTC",
        intervalMs: body.kind === "INTERVAL" ? (typeof body.intervalMs === "number" ? body.intervalMs : null) : null,
        misfirePolicy: body.misfirePolicy,
        overlapPolicy: body.overlapPolicy,
        catchUpLimit: body.misfirePolicy === "CATCH_UP" ? (body.catchUpLimit ?? null) : null,
        inputJson: JSON.stringify(normalized ?? {}),
        urlFilesJson: JSON.stringify(urlFiles),
        nextRunAt: null,
        lastRunAt: null,
      },
      select: {
        id: true,
        publicId: true,
        kind: true,
        cron: true,
        timezone: true,
        intervalMs: true,
        nextRunAt: true,
        lastRunAt: true,
        createdAt: true,
      },
    })
    const next = computeNextRunAt(created satisfies ScheduleLike, new Date())
    await tx.schedule.update({
      where: { id: created.id },
      data: { nextRunAt: next },
      select: { id: true },
    })
    return { internalId: created.id, publicId: created.publicId }
  })

  await emitScheduleState(schedule.internalId).catch(() => {})
  return { ok: true as const, schedulePublicId: schedule.publicId }
}
