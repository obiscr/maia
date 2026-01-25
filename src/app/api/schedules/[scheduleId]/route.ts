import { prisma } from "@/lib/server/db"
import { fail, notFound, ok } from "@/lib/server/http/response"
import { zodIssues } from "@/lib/shared/http/zod"
import { withApiObservability } from "@/lib/server/observability"
import { computeNextRunAt, type ScheduleLike } from "@/lib/server/maia/scheduler"
import { emitScheduleDeleted, emitScheduleState } from "@/lib/server/maia/realtime"
import { isRecord } from "@/lib/shared/lang/is-record"
import { z } from "zod"
import { findReservedKeysInRecord, parseWorkflowInputSpecWithOpts } from "@/lib/shared/maia/input-spec"
import { validateWithJsonSchema } from "@/lib/server/maia/jsonschema"
import { workflowSnapshotSchema } from "@/lib/server/maia/snapshot"
import { createWorkflowVersionSnapshot, getLatestWorkflowVersion } from "@/lib/server/maia/workflow-versioning"
import { normalizeUrlFilesForStorage, parseStoredUrlFilesJson } from "@/lib/server/maia/url-files"
import type { ApiIssue } from "@/lib/shared/http/types"
import { requireRequestAuth } from "@/lib/server/authz"
import { makeUpdateAudit } from "@/lib/server/audit/write"
import { getScheduleFindFirstWhereByPublicId } from "@/lib/server/scopes/schedules-scope"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export const runtime = "nodejs"

const patchScheduleSchema = z
  .object({
    name: z.string().trim().max(200).nullable().optional(),
    enabled: z.boolean().optional(),
    kind: z.enum(["CRON", "INTERVAL"]).optional(),
    cron: z.string().trim().max(200).nullable().optional(),
    timezone: z.string().trim().max(64).nullable().optional(),
    intervalMs: z.coerce.number().int().min(1000).nullable().optional(),
    misfirePolicy: z.enum(["SKIP", "FIRE_ONCE", "CATCH_UP"]).optional(),
    catchUpLimit: z.coerce.number().int().min(1).max(100).nullable().optional(),
    overlapPolicy: z.enum(["SKIP", "ALLOW"]).optional(),
    pinnedWorkflowVersionNumber: z.coerce.number().int().min(1).nullable().optional(),
    inputJson: z.unknown().optional(),
    urlFiles: z
      .array(
        z.object({
          url: z.string().min(1),
          name: z.string().optional(),
          id: z.string().optional(),
        }),
      )
      .optional(),
  })
  .strict()

export const GET = withApiObservability(async (_req: Request, ctx: { params: Promise<{ scheduleId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { scheduleId } = await ctx.params
  const schedulePublicId = String(scheduleId || "")
    .trim()
    .toLowerCase()
  const schedule = await prisma.schedule.findFirst({
    where: getScheduleFindFirstWhereByPublicId(viewerAuth, schedulePublicId),
    select: {
      id: true,
      publicId: true,
      publicNumber: true,
      name: true,
      enabled: true,
      workflowId: true,
      workflow: { select: { publicId: true, publicNumber: true, name: true } },
      pinnedWorkflowVersion: { select: { version: true, createdAt: true } },
      kind: true,
      cron: true,
      timezone: true,
      intervalMs: true,
      misfirePolicy: true,
      catchUpLimit: true,
      overlapPolicy: true,
      inputJson: true,
      urlFilesJson: true,
      nextRunAt: true,
      lastRunAt: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  if (!schedule) return notFound("NOT_FOUND")
  const urlFiles = parseStoredUrlFilesJson(schedule.urlFilesJson)
  // API/UI convention: avoid leaking internal UUIDs (including nested objects).
  return ok({
    schedule: {
      id: schedule.publicId,
      publicId: schedule.publicId,
      publicNumber: schedule.publicNumber,
      name: schedule.name,
      enabled: schedule.enabled,
      workflowId: schedule.workflow?.publicId ?? null,
      workflow: schedule.workflow
        ? {
            id: schedule.workflow.publicId,
            publicId: schedule.workflow.publicId,
            publicNumber: schedule.workflow.publicNumber,
            name: schedule.workflow.name,
          }
        : null,
      pinnedWorkflowVersion: schedule.pinnedWorkflowVersion
        ? {
            version: schedule.pinnedWorkflowVersion.version,
            createdAt: schedule.pinnedWorkflowVersion.createdAt,
          }
        : null,
      kind: schedule.kind,
      cron: schedule.cron,
      timezone: schedule.timezone,
      intervalMs: schedule.intervalMs,
      misfirePolicy: schedule.misfirePolicy,
      catchUpLimit: schedule.catchUpLimit,
      overlapPolicy: schedule.overlapPolicy,
      inputJson: schedule.inputJson,
      urlFiles,
      nextRunAt: schedule.nextRunAt,
      lastRunAt: schedule.lastRunAt,
      createdAt: schedule.createdAt,
      updatedAt: schedule.updatedAt,
    },
  })
})

export const PATCH = withApiObservability(async (req: Request, ctx: { params: Promise<{ scheduleId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { scheduleId } = await ctx.params
  const schedulePublicId = String(scheduleId || "")
    .trim()
    .toLowerCase()
  let body: z.infer<typeof patchScheduleSchema>
  try {
    body = patchScheduleSchema.parse(await req.json())
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    throw e
  }

  const now = new Date()
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.schedule.findFirst({
        where: getScheduleFindFirstWhereByPublicId(viewerAuth, schedulePublicId),
        select: {
          id: true,
          workflowId: true,
          pinnedWorkflowVersionId: true,
          name: true,
          enabled: true,
          kind: true,
          cron: true,
          timezone: true,
          intervalMs: true,
          misfirePolicy: true,
          catchUpLimit: true,
          overlapPolicy: true,
          inputJson: true,
          urlFilesJson: true,
          nextRunAt: true,
          lastRunAt: true,
          createdAt: true,
          updatedAt: true,
        },
      })
      if (!existing) return null

      const nextEnabled = typeof body.enabled === "boolean" ? body.enabled : existing.enabled
      const nextKind = (body.kind ?? existing.kind) as "CRON" | "INTERVAL"

      const normalizeName = (v: unknown) => {
        if (typeof v !== "string") return null
        const t = v.trim()
        return t.length ? t : null
      }

      const normalizeCron = (v: unknown) => {
        if (typeof v !== "string") return null
        const t = v.trim()
        return t.length ? t : null
      }

      const normalizeTimezone = (v: unknown) => {
        const t = typeof v === "string" ? v.trim() : ""
        return t.length ? t : "UTC"
      }

      const specChanged =
        body.kind !== undefined ||
        body.cron !== undefined ||
        body.timezone !== undefined ||
        body.intervalMs !== undefined

      const nextCronRaw = body.cron === undefined ? existing.cron : normalizeCron(body.cron ?? "")
      const nextTimezone =
        body.timezone === undefined ? String(existing.timezone || "UTC") : normalizeTimezone(body.timezone ?? "")
      const nextIntervalMs = body.intervalMs === undefined ? existing.intervalMs : body.intervalMs

      // Validate and normalize fields by kind.
      let cronToWrite: string | null = null
      let intervalToWrite: number | null = null
      if (nextKind === "CRON") {
        const cron = normalizeCron(nextCronRaw ?? "")
        if (!cron) return { error: { status: 422, code: "INVALID_CRON" as const } }
        cronToWrite = cron
        intervalToWrite = null
      } else {
        const ms = typeof nextIntervalMs === "number" ? nextIntervalMs : null
        if (!ms || !Number.isFinite(ms) || ms < 1000)
          return { error: { status: 422, code: "INVALID_INTERVAL" as const } }
        intervalToWrite = Math.floor(ms)
        cronToWrite = null
      }

      // nextRunAt rules:
      // - if disabled => null
      // - if schedule spec changed or toggled enabled => recompute from now
      // - if name-only change => keep existing nextRunAt
      let nextRunAt: Date | null = null
      if (nextEnabled) {
        const baseNext = specChanged || body.enabled !== undefined ? null : existing.nextRunAt
        const like: ScheduleLike = {
          kind: nextKind,
          cron: cronToWrite,
          timezone: nextTimezone,
          intervalMs: intervalToWrite,
          nextRunAt: baseNext,
          lastRunAt: existing.lastRunAt,
          createdAt: existing.createdAt,
        }
        try {
          nextRunAt = computeNextRunAt(like, now)
        } catch (e) {
          return {
            error: { status: 422, code: "INVALID_CRON" as const },
          }
        }
      } else {
        nextRunAt = null
      }

      const data: Record<string, unknown> = {}
      if (body.name !== undefined) data.name = body.name === null ? null : normalizeName(body.name)
      if (body.enabled !== undefined) data.enabled = nextEnabled
      if (specChanged) {
        data.kind = nextKind
        data.cron = cronToWrite
        data.timezone = nextTimezone
        data.intervalMs = intervalToWrite
      }
      data.nextRunAt = nextRunAt

      const nextMisfire = (body.misfirePolicy ?? existing.misfirePolicy) as "SKIP" | "FIRE_ONCE" | "CATCH_UP"
      const nextOverlap = (body.overlapPolicy ?? existing.overlapPolicy) as "SKIP" | "ALLOW"

      if (body.misfirePolicy !== undefined) data.misfirePolicy = nextMisfire
      if (body.overlapPolicy !== undefined) data.overlapPolicy = nextOverlap

      if (body.catchUpLimit !== undefined) {
        if (nextMisfire !== "CATCH_UP") {
          return { error: { status: 422, code: "INVALID_CATCH_UP_LIMIT" as const } }
        }
        data.catchUpLimit = body.catchUpLimit ?? null
      } else if (body.misfirePolicy !== undefined && nextMisfire !== "CATCH_UP") {
        // When switching away from CATCH_UP, clear any prior limit.
        data.catchUpLimit = null
      }

      // Pinned workflow version: accept version NUMBER (do not expose internal UUIDs).
      let nextPinnedWorkflowVersionId: string | null = existing.pinnedWorkflowVersionId ?? null
      if (body.pinnedWorkflowVersionNumber !== undefined) {
        if (body.pinnedWorkflowVersionNumber == null) {
          data.pinnedWorkflowVersionId = null
          nextPinnedWorkflowVersionId = null
        } else {
          const ver = body.pinnedWorkflowVersionNumber
          const row = await tx.workflowVersion.findUnique({
            where: { workflowId_version: { workflowId: existing.workflowId, version: ver } },
            select: { id: true },
          })
          if (!row) return { error: { status: 422, code: "INVALID_PINNED_WORKFLOW_VERSION" as const } }
          data.pinnedWorkflowVersionId = row.id
          nextPinnedWorkflowVersionId = row.id
        }
      }

      // Resolve workflow version snapshot for input validation.
      // Prefer pinned (if set), otherwise latest (synthesize legacy v1 if needed).
      let version = nextPinnedWorkflowVersionId
        ? await tx.workflowVersion.findUnique({
            where: { id: nextPinnedWorkflowVersionId },
            select: { id: true, version: true, snapshotJson: true, createdAt: true },
          })
        : await getLatestWorkflowVersion(existing.workflowId)
      if (!version) {
        const wf = await tx.workflow.findUnique({
          where: { id: existing.workflowId },
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
          const steps = await tx.workflowStep.findMany({ where: { workflowId: wf.id }, orderBy: [{ key: "asc" }] })
          const deps = await tx.workflowStepDep.findMany({ where: { workflowId: wf.id } })
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
          error: {
            status: 500,
            code: "WORKFLOW_INPUT_SPEC_INVALID" as const,
            meta: { field: "inputSpec" },
          },
        }
      }
      const inputSpec = specParsed.spec

      if (body.inputJson !== undefined) {
        let normalized = isRecord(body.inputJson) ? body.inputJson : { value: body.inputJson }
        if (isRecord(normalized)) {
          const reserved = findReservedKeysInRecord(normalized, snapshot.reservedInitialInputKeys)
          if (reserved.length) {
            return {
              error: {
                status: 422,
                code: "INVALID_INPUT_JSON" as const,
                issues: reserved.map((field) => ({
                  path: `/inputJson/${field}`,
                  keyword: "reserved",
                  params: { field },
                })),
              },
            }
          }
        }
        data.inputJson = JSON.stringify(normalized ?? {})

        if (inputSpec) {
          if (!isRecord(body.inputJson)) {
            const issues: ApiIssue[] = [{ path: "/inputJson", keyword: "type", params: { expected: "object" } }]
            return { error: { status: 422, code: "INVALID_INPUT_JSON" as const, issues } }
          }
          const v = validateWithJsonSchema({ schema: inputSpec.paramsSchema, data: body.inputJson })
          if (!v.ok) return { error: { status: 422, code: "INVALID_INPUT_JSON" as const, issues: v.issues } }
        }
      }

      if (body.urlFiles !== undefined) {
        const urlFiles = normalizeUrlFilesForStorage(body.urlFiles)
        if (inputSpec?.fileInputs?.urlFiles) {
          const enabled = inputSpec.fileInputs.urlFiles.enabled !== false
          if (!enabled && urlFiles.length) {
            const issues: ApiIssue[] = [{ path: "/urlFiles", keyword: "disabled", params: { field: "urlFiles" } }]
            return { error: { status: 422, code: "INVALID_INPUT_FILES" as const, issues } }
          }
          if (inputSpec.fileInputs.urlFiles.required && urlFiles.length === 0) {
            const issues: ApiIssue[] = [{ path: "/urlFiles", keyword: "required", params: { field: "urlFiles" } }]
            return { error: { status: 422, code: "INVALID_INPUT_FILES" as const, issues } }
          }
          if (
            typeof inputSpec.fileInputs.urlFiles.maxItems === "number" &&
            urlFiles.length > inputSpec.fileInputs.urlFiles.maxItems
          ) {
            const issues: ApiIssue[] = [
              {
                path: "/urlFiles",
                keyword: "maxItems",
                params: { maxItems: inputSpec.fileInputs.urlFiles.maxItems },
              },
            ]
            return {
              error: {
                status: 422,
                code: "INVALID_INPUT_FILES" as const,
                issues,
                meta: { maxItems: inputSpec.fileInputs.urlFiles.maxItems },
              },
            }
          }
        } else if (urlFiles.length) {
          const issues: ApiIssue[] = [{ path: "/urlFiles", keyword: "not_supported", params: { field: "urlFiles" } }]
          return { error: { status: 422, code: "INVALID_INPUT_FILES" as const, issues } }
        }
        data.urlFilesJson = JSON.stringify(urlFiles)
      }

      // Audit
      Object.assign(data, makeUpdateAudit(auth))

      const s = await tx.schedule.update({
        where: { id: existing.id },
        data,
        select: {
          id: true,
          publicId: true,
          publicNumber: true,
          name: true,
          enabled: true,
          kind: true,
          cron: true,
          timezone: true,
          intervalMs: true,
          misfirePolicy: true,
          catchUpLimit: true,
          overlapPolicy: true,
          pinnedWorkflowVersion: { select: { version: true, createdAt: true } },
          inputJson: true,
          urlFilesJson: true,
          nextRunAt: true,
          lastRunAt: true,
          createdAt: true,
          updatedAt: true,
        },
      })
      return { schedule: s }
    })

    if (!updated) return notFound("NOT_FOUND")
    if (updated.error) return fail(updated.error)
    await emitScheduleState(updated.schedule.id).catch(() => {})
    // API/UI convention: avoid leaking internal UUIDs.
    const urlFiles = parseStoredUrlFilesJson(updated.schedule.urlFilesJson)
    // Avoid returning urlFilesJson directly; prefer parsed urlFiles array.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { urlFilesJson: _urlFilesJson, publicId, ...rest } = updated.schedule
    return ok({ schedule: { ...rest, id: publicId, urlFiles } })
  } catch {
    return fail({ status: 500, code: "UPDATE_FAILED" })
  }
})

export const DELETE = withApiObservability(async (_req: Request, ctx: { params: Promise<{ scheduleId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { scheduleId } = await ctx.params
  const schedulePublicId = String(scheduleId || "")
    .trim()
    .toLowerCase()
  const existing = await prisma.schedule.findFirst({
    where: getScheduleFindFirstWhereByPublicId(viewerAuth, schedulePublicId),
    select: { id: true, publicId: true, ownerUser: { select: { publicId: true } } },
  })
  if (!existing) return notFound("NOT_FOUND")
  try {
    // NOTE: JobRun.scheduleId is optional but the relation uses onDelete: Restrict, so we must
    // detach job runs before deleting the schedule record.
    await prisma.$transaction([
      prisma.jobRun.updateMany({ where: { scheduleId: existing.id }, data: { scheduleId: null } }),
      prisma.schedule.delete({ where: { id: existing.id } }),
    ])
  } catch {
    return fail({ status: 500, code: "DELETE_FAILED" })
  }
  await emitScheduleDeleted({
    scheduleId: existing.publicId,
    ownerUserPublicId: existing.ownerUser?.publicId ?? null,
  }).catch(() => {})
  return ok({ ok: true })
})
