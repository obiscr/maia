import crypto from "node:crypto"
import { z } from "zod"
import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import { fail, ok } from "@/lib/server/http/response"
import { zodIssues } from "@/lib/shared/http/zod"
import { withApiObservability } from "@/lib/server/observability"
import { computeNextRunAt, type ScheduleLike } from "@/lib/server/maia/scheduler"
import { emitScheduleState } from "@/lib/server/maia/realtime"
import { runIdempotentOperation } from "@/lib/server/operations/run-operation"
import { allocatePublicId } from "@/lib/server/public-ids"
import { isRecord } from "@/lib/shared/lang/is-record"
import { findReservedKeysInRecord, parseWorkflowInputSpecWithOpts } from "@/lib/shared/maia/input-spec"
import { validateWithJsonSchema } from "@/lib/server/maia/jsonschema"
import { workflowSnapshotSchema } from "@/lib/server/maia/snapshot"
import { createWorkflowVersionSnapshot, getLatestWorkflowVersion } from "@/lib/server/maia/workflow-versioning"
import { normalizeUrlFilesForStorage } from "@/lib/server/maia/url-files"
import type { ApiIssue } from "@/lib/shared/http/types"
import { requireRequestAuth } from "@/lib/server/authz"
import { makeCreateAudit } from "@/lib/server/audit/write"
import { getSchedulesListVisibilityWhere } from "@/lib/server/scopes/schedules-scope"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { getWorkflowFindFirstWhereById, getWorkflowFindFirstWhereByPublicId } from "@/lib/server/scopes/workflows-scope"

export const runtime = "nodejs"

const getSchedulesQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(["ENABLED", "DISABLED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(["CREATED_DESC", "CREATED_ASC"]).default("CREATED_DESC"),
})

const createScheduleSchema = z.object({
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

export const GET = withApiObservability(async (req: Request) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const url = new URL(req.url)
  let qp: z.infer<typeof getSchedulesQuerySchema>
  try {
    qp = getSchedulesQuerySchema.parse({
      q: url.searchParams.get("q") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
    })
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_QUERY", issues: zodIssues(e) })
    throw e
  }

  const whereBase =
    qp.q && qp.q.length
      ? {
          OR: [
            { publicId: { contains: qp.q } },
            { name: { contains: qp.q } },
            { workflow: { publicId: { contains: qp.q } } },
            { workflow: { name: { contains: qp.q } } },
          ],
        }
      : undefined

  const whereParts: Prisma.ScheduleWhereInput[] = []
  const visibilityWhere = getSchedulesListVisibilityWhere(viewerAuth)
  if (visibilityWhere) whereParts.push(visibilityWhere)
  if (whereBase) whereParts.push(whereBase)
  const where = whereParts.length ? { AND: whereParts } : undefined

  const whereWithStatus =
    qp.status === "ENABLED"
      ? where
        ? { ...where, enabled: true }
        : { enabled: true }
      : qp.status === "DISABLED"
        ? where
          ? { ...where, enabled: false }
          : { enabled: false }
        : where

  const orderBy = qp.sort === "CREATED_ASC" ? [{ createdAt: "asc" as const }] : [{ createdAt: "desc" as const }]

  const total = await prisma.schedule.count({ where: whereWithStatus })
  const schedules = await prisma.schedule.findMany({
    where: whereWithStatus,
    orderBy,
    skip: (qp.page - 1) * qp.pageSize,
    take: qp.pageSize,
    select: {
      id: true,
      publicId: true,
      publicNumber: true,
      name: true,
      enabled: true,
      workflowId: true,
      workflow: { select: { name: true, publicId: true } },
      kind: true,
      cron: true,
      timezone: true,
      intervalMs: true,
      inputJson: true,
      nextRunAt: true,
      lastRunAt: true,
      lastFireJobRunId: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  const lastFireInternalJobRunIds = schedules
    .map((s) => s.lastFireJobRunId)
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)

  const lastFireJobRuns =
    lastFireInternalJobRunIds.length > 0
      ? await prisma.jobRun.findMany({
          where: { id: { in: lastFireInternalJobRunIds } },
          select: { id: true, publicId: true, run: { select: { publicId: true } } },
        })
      : []
  const lastFireJobRunById = new Map(lastFireJobRuns.map((j) => [j.id, j]))

  return ok({
    total,
    schedules: schedules.map((s) => ({
      // List/UI convention: `id` is the human-friendly public id (avoid leaking internal UUIDs).
      id: s.publicId,
      publicId: s.publicId,
      publicNumber: s.publicNumber,
      name: s.name,
      enabled: s.enabled,
      workflowId: s.workflow?.publicId ?? null,
      workflowName: s.workflow?.name ?? "—",
      lastJobId: s.lastFireJobRunId ? (lastFireJobRunById.get(s.lastFireJobRunId)?.publicId ?? null) : null,
      lastRunId: s.lastFireJobRunId ? (lastFireJobRunById.get(s.lastFireJobRunId)?.run?.publicId ?? null) : null,
      kind: s.kind,
      cron: s.cron,
      timezone: s.timezone,
      intervalMs: s.intervalMs,
      inputJson: s.inputJson,
      nextRunAt: s.nextRunAt,
      lastRunAt: s.lastRunAt,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    })),
  })
})

export const POST = withApiObservability(async (req: Request) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  return await runIdempotentOperation({
    req,
    action: "SCHEDULE_CREATE",
    scope: "schedules:create",
    targetType: "schedule",
    exec: async ({ operationId, operationInternalId: _operationInternalId }) => {
      let body: z.infer<typeof createScheduleSchema>
      try {
        body = createScheduleSchema.parse(await req.json())
      } catch (e) {
        if (e instanceof z.ZodError) return { status: 422, body: { code: "INVALID_BODY", issues: zodIssues(e) } }
        throw e
      }

      const workflowPublicId = String(body.workflowId || "")
        .trim()
        .toLowerCase()
      const workflow =
        (await prisma.workflow.findFirst({
          where: getWorkflowFindFirstWhereByPublicId(viewerAuth, workflowPublicId),
        })) ??
        (await prisma.workflow.findFirst({
          where: getWorkflowFindFirstWhereById(viewerAuth, body.workflowId),
        }))
      if (!workflow) return { status: 404, body: { code: "WORKFLOW_NOT_FOUND" } }

      // Resolve pinned workflow version by NUMBER to internal UUID.
      // (We avoid leaking internal workflowVersion.id to the client.)
      let pinnedWorkflowVersionId: string | null = null
      if (body.pinnedWorkflowVersionNumber != null) {
        const ver = body.pinnedWorkflowVersionNumber
        const row = await prisma.workflowVersion.findUnique({
          where: { workflowId_version: { workflowId: workflow.id, version: ver } },
          select: { id: true },
        })
        if (!row) {
          return {
            status: 422,
            body: {
              code: "INVALID_PINNED_WORKFLOW_VERSION",
              issues: [
                {
                  path: "/pinnedWorkflowVersionNumber",
                  keyword: "not_found",
                  params: { version: ver },
                },
              ],
            },
          }
        }
        pinnedWorkflowVersionId = row.id
      }

      // Normalize payload to an object container (reserved keys are validated against the pinned snapshot below).
      let normalized = isRecord(body.inputJson) ? body.inputJson : { value: body.inputJson }

      // Validate schedule inputs against the workflow version snapshot (best-effort; aligns with /api/jobs).
      // - If pinned, validate against pinned version.
      // - Else validate against latest version (synthesize legacy v1 if needed).
      let version = pinnedWorkflowVersionId
        ? await prisma.workflowVersion.findUnique({
            where: { id: pinnedWorkflowVersionId },
            select: { id: true, version: true, snapshotJson: true, createdAt: true },
          })
        : await getLatestWorkflowVersion(workflow.id)
      if (!version) {
        // Back-compat: synthesize v1 from current workflow tables.
        const wf = await prisma.workflow.findUnique({
          where: { id: workflow.id },
          select: {
            id: true,
            name: true,
            dependencies: true,
            envJson: true,
            inputSpec: true,
            outputsSpec: true,
            depsHash: true,
          },
        })
        if (wf) {
          const steps = await prisma.workflowStep.findMany({
            where: { workflowId: wf.id },
            orderBy: [{ key: "asc" }],
          })
          const deps = await prisma.workflowStepDep.findMany({ where: { workflowId: wf.id } })
          const depMap = new Map<string, string[]>()
          for (const d of deps) {
            const arr = depMap.get(d.stepId) ?? []
            arr.push(d.dependsOnStepId)
            depMap.set(d.stepId, arr)
          }
          await createWorkflowVersionSnapshot({
            workflowId: wf.id,
            workflowName: wf.name,
            description: null,
            createdByUserId: auth.userId,
            dependencies: wf.dependencies,
            envJson: wf.envJson ?? "{}",
            inputSpec: wf.inputSpec ?? null,
            outputsSpec: wf.outputsSpec ?? null,
            depsHash: wf.depsHash,
            steps: steps.map((s) => ({
              stepKey: s.key,
              name: s.name,
              scriptEsm: s.scriptEsm,
              timeoutMs: s.timeoutMs,
              deps: depMap.get(s.key) ?? [],
            })),
          })
          version = await getLatestWorkflowVersion(wf.id)
        }
      }
      const snapshot = workflowSnapshotSchema.parse(JSON.parse(version?.snapshotJson || "{}"))
      const specParsed = parseWorkflowInputSpecWithOpts(snapshot.inputSpec ?? null, {
        reservedKeys: snapshot.reservedInitialInputKeys,
      })
      if (snapshot.inputSpec && !specParsed.spec) {
        return {
          status: 500,
          body: { code: "WORKFLOW_INPUT_SPEC_INVALID", meta: { field: "inputSpec" } },
        }
      }
      const inputSpec = specParsed.spec

      // Reject user-supplied reserved keys using the pinned snapshot list (reproducible across future changes).
      if (isRecord(normalized)) {
        const reserved = findReservedKeysInRecord(normalized, snapshot.reservedInitialInputKeys)
        if (reserved.length) {
          return {
            status: 422,
            body: {
              code: "INVALID_INPUT_JSON",
              issues: reserved.map((field) => ({
                path: `/inputJson/${field}`,
                keyword: "reserved",
                params: { field },
              })),
            },
          }
        }
      }

      // Validate params schema (if present).
      if (inputSpec) {
        if (!isRecord(body.inputJson)) {
          const issues: ApiIssue[] = [{ path: "/inputJson", keyword: "type", params: { type: "object" } }]
          return { status: 422, body: { code: "INVALID_INPUT_JSON", issues } }
        }
        const v = validateWithJsonSchema({ schema: inputSpec.paramsSchema, data: body.inputJson })
        if (!v.ok) return { status: 422, body: { code: "INVALID_INPUT_JSON", issues: v.issues } }
      }

      // Validate urlFiles against fileInputs.urlFiles if configured; otherwise reject non-empty urlFiles.
      const urlFiles = normalizeUrlFilesForStorage(body.urlFiles)
      if (inputSpec?.fileInputs?.urlFiles) {
        const enabled = inputSpec.fileInputs.urlFiles.enabled !== false
        if (!enabled && urlFiles.length) {
          const issues: ApiIssue[] = [{ path: "/urlFiles", keyword: "disabled", params: { field: "urlFiles" } }]
          return { status: 422, body: { code: "INVALID_INPUT_FILES", issues } }
        }
        if (inputSpec.fileInputs.urlFiles.required && urlFiles.length === 0) {
          const issues: ApiIssue[] = [
            { path: "/urlFiles", keyword: "required", params: { missingProperty: "urlFiles" } },
          ]
          return { status: 422, body: { code: "INVALID_INPUT_FILES", issues } }
        }
        if (
          typeof inputSpec.fileInputs.urlFiles.maxItems === "number" &&
          urlFiles.length > inputSpec.fileInputs.urlFiles.maxItems
        ) {
          const issues: ApiIssue[] = [
            {
              path: "/urlFiles",
              keyword: "maxItems",
              params: { limit: inputSpec.fileInputs.urlFiles.maxItems },
            },
          ]
          return {
            status: 422,
            body: { code: "INVALID_INPUT_FILES", issues, meta: { maxItems: inputSpec.fileInputs.urlFiles.maxItems } },
          }
        }
      } else if (urlFiles.length) {
        const issues: ApiIssue[] = [{ path: "/urlFiles", keyword: "not_supported", params: { field: "urlFiles" } }]
        return { status: 422, body: { code: "INVALID_INPUT_FILES", issues } }
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
            ...makeCreateAudit(auth),
            pinnedWorkflowVersionId,
            kind: body.kind,
            cron: body.kind === "CRON" ? (body.cron?.trim() ? body.cron.trim() : null) : null,
            timezone: body.timezone?.trim() ? body.timezone.trim() : "UTC",
            intervalMs:
              body.kind === "INTERVAL" ? (typeof body.intervalMs === "number" ? body.intervalMs : null) : null,
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
      return {
        status: 201,
        headers: { Location: `/api/schedules/${schedule.publicId}` },
        body: {
          // Avoid leaking internal UUIDs.
          schedule: { id: schedule.publicId, publicId: schedule.publicId },
          operationId,
        },
      }
    },
  })
})
