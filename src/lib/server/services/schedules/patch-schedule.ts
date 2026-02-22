import "server-only"

import { z } from "zod"

import { prisma } from "@/lib/server/db"
import { computeNextRunAt, validateCronExpression, type ScheduleLike } from "@/lib/server/maia/scheduler"
import { emitScheduleState } from "@/lib/server/maia/realtime"
import { isRecord } from "@/lib/shared/lang/is-record"
import { findReservedKeysInRecord, parseWorkflowInputSpecWithOpts } from "@/lib/shared/maia/input-spec"
import { validateWithJsonSchema } from "@/lib/server/maia/jsonschema"
import { workflowSnapshotSchema } from "@/lib/server/maia/snapshot"
import { createWorkflowVersionSnapshot, getLatestWorkflowVersion } from "@/lib/server/maia/workflow-versioning"
import { normalizeRetryPolicyJson } from "@/lib/server/maia/workflow-snapshot-normalize"
import { normalizeUrlFilesForStorage, parseStoredUrlFilesJson } from "@/lib/server/maia/url-files"
import type { ApiIssue } from "@/lib/shared/http/types"
import type { RequestAuthContext } from "@/lib/server/authz"
import { makeUpdateAudit } from "@/lib/server/audit/write"
import { getScheduleFindFirstWhereByPublicId } from "@/lib/server/scopes/schedules-scope"
import type { ViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export const patchScheduleSchema = z
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

export async function patchScheduleByPublicId(params: {
  auth: RequestAuthContext
  viewerAuth: ViewerAuthContext
  scheduleId: string
  body: z.infer<typeof patchScheduleSchema>
}) {
  const schedulePublicId = String(params.scheduleId || "")
    .trim()
    .toLowerCase()
  const body = params.body
  const now = new Date()
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.schedule.findFirst({
        where: getScheduleFindFirstWhereByPublicId(params.viewerAuth, schedulePublicId),
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

      let cronToWrite: string | null = null
      let intervalToWrite: number | null = null
      if (nextKind === "CRON") {
        const cron = normalizeCron(nextCronRaw ?? "")
        if (!cron) return { error: { status: 422, code: "INVALID_CRON" as const } }
        try {
          validateCronExpression(cron)
        } catch {
          return { error: { status: 422, code: "INVALID_CRON" as const } }
        }
        cronToWrite = cron
        intervalToWrite = null
      } else {
        const ms = typeof nextIntervalMs === "number" ? nextIntervalMs : null
        if (!ms || !Number.isFinite(ms) || ms < 1000)
          return { error: { status: 422, code: "INVALID_INTERVAL" as const } }
        intervalToWrite = Math.floor(ms)
        cronToWrite = null
      }

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
        } catch {
          return { error: { status: 422, code: "INVALID_CRON" as const } }
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
        if (nextMisfire !== "CATCH_UP") return { error: { status: 422, code: "INVALID_CATCH_UP_LIMIT" as const } }
        data.catchUpLimit = body.catchUpLimit ?? null
      } else if (body.misfirePolicy !== undefined && nextMisfire !== "CATCH_UP") {
        data.catchUpLimit = null
      }

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

      let version = nextPinnedWorkflowVersionId
        ? await tx.workflowVersion.findUnique({
            where: { id: nextPinnedWorkflowVersionId },
            select: { snapshotJson: true },
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
            createdByUserId: params.auth.userId,
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
              retryPolicy: normalizeRetryPolicyJson(s.retryPolicyJson),
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
          error: { status: 500, code: "WORKFLOW_INPUT_SPEC_INVALID" as const, meta: { field: "inputSpec" } },
        }
      }
      const inputSpec = specParsed.spec

      if (body.inputJson !== undefined) {
        const normalized = isRecord(body.inputJson) ? body.inputJson : { value: body.inputJson }
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
        if (inputSpec?.filesInput?.urlFiles) {
          const enabled = inputSpec.filesInput.urlFiles.enabled !== false
          if (!enabled && urlFiles.length) {
            const issues: ApiIssue[] = [{ path: "/urlFiles", keyword: "disabled", params: { field: "urlFiles" } }]
            return { error: { status: 422, code: "INVALID_INPUT_FILES" as const, issues } }
          }
          if (inputSpec.filesInput.urlFiles.required && urlFiles.length === 0) {
            const issues: ApiIssue[] = [{ path: "/urlFiles", keyword: "required", params: { field: "urlFiles" } }]
            return { error: { status: 422, code: "INVALID_INPUT_FILES" as const, issues } }
          }
          if (
            typeof inputSpec.filesInput.urlFiles.maxItems === "number" &&
            urlFiles.length > inputSpec.filesInput.urlFiles.maxItems
          ) {
            const issues: ApiIssue[] = [
              {
                path: "/urlFiles",
                keyword: "maxItems",
                params: { maxItems: inputSpec.filesInput.urlFiles.maxItems },
              },
            ]
            return {
              error: {
                status: 422,
                code: "INVALID_INPUT_FILES" as const,
                issues,
                meta: { maxItems: inputSpec.filesInput.urlFiles.maxItems },
              },
            }
          }
        } else if (urlFiles.length) {
          const issues: ApiIssue[] = [{ path: "/urlFiles", keyword: "not_supported", params: { field: "urlFiles" } }]
          return { error: { status: 422, code: "INVALID_INPUT_FILES" as const, issues } }
        }
        data.urlFilesJson = JSON.stringify(urlFiles)
      }

      Object.assign(data, makeUpdateAudit(params.auth))
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

    if (!updated) return { ok: false as const, status: 404, code: "NOT_FOUND" as const }
    if ("error" in updated && updated.error) {
      return {
        ok: false as const,
        status: updated.error.status,
        code: updated.error.code,
        issues: (updated.error as { issues?: ApiIssue[] }).issues,
        meta: (updated.error as { meta?: Record<string, unknown> }).meta,
      }
    }
    await emitScheduleState(updated.schedule.id).catch(() => {})
    const urlFiles = parseStoredUrlFilesJson(updated.schedule.urlFilesJson)
    const { urlFilesJson: _urlFilesJson, publicId, ...rest } = updated.schedule
    return { ok: true as const, schedule: { ...rest, id: publicId, urlFiles } }
  } catch {
    return { ok: false as const, status: 500, code: "UPDATE_FAILED" as const }
  }
}
