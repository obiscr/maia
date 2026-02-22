import "server-only"

import { z } from "zod"

import { prisma } from "@/lib/server/db"
import { parseWorkflowInputSpecWithOpts } from "@/lib/shared/maia/input-spec"
import type { ApiIssue } from "@/lib/shared/http/types"
import { workflowSnapshotSchema } from "@/lib/server/maia/snapshot"
import { createWorkflowVersionSnapshot, getLatestWorkflowVersion } from "@/lib/server/maia/workflow-versioning"
import { normalizeRetryPolicyJson } from "@/lib/server/maia/workflow-snapshot-normalize"
import { normalizeUrlFilesForStorage, parseStoredUrlFilesJson } from "@/lib/server/maia/url-files"
import type { RequestAuthContext } from "@/lib/server/authz"
import { makeUpdateAudit } from "@/lib/server/audit/write"
import { getBatchFindFirstWhereByPublicId } from "@/lib/server/scopes/batches-scope"
import type { ViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export const patchBatchSchema = z
  .object({
    name: z.string().trim().max(200).nullable().optional(),
    pinnedWorkflowVersionNumber: z.coerce.number().int().min(1).nullable().optional(),
    concurrencyLimit: z.coerce.number().int().min(1).max(10_000).nullable().optional(),
    rampUpSeconds: z.coerce.number().int().min(1).max(86_400).nullable().optional(),
    autoMaxConcurrency: z.coerce.number().int().min(1).max(10_000).nullable().optional(),
    failFast: z.coerce.boolean().optional(),
    maxFailures: z.coerce.number().int().min(1).max(10_000).nullable().optional(),
    sourceJson: z.unknown().optional(),
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

export async function patchBatchByPublicId(params: {
  auth: RequestAuthContext
  viewerAuth: ViewerAuthContext
  batchId: string
  body: z.infer<typeof patchBatchSchema>
}) {
  const batchPublicId = String(params.batchId || "")
    .trim()
    .toLowerCase()
  const body = params.body

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.batch.findFirst({
        where: getBatchFindFirstWhereByPublicId(params.viewerAuth, batchPublicId),
        select: {
          id: true,
          workflowId: true,
          pinnedWorkflowVersionId: true,
          startedAt: true,
          _count: { select: { jobRuns: true } },
        },
      })
      if (!existing) return null

      const locked = (existing._count?.jobRuns ?? 0) > 0 || !!existing.startedAt
      const data: Record<string, unknown> = {}
      if (body.name !== undefined) data.name = body.name === null ? null : body.name?.trim() ? body.name.trim() : null
      if (body.sourceJson !== undefined) data.sourceJson = JSON.stringify(body.sourceJson ?? {})

      let nextPinnedWorkflowVersionId: string | null = existing.pinnedWorkflowVersionId ?? null
      if (body.pinnedWorkflowVersionNumber !== undefined) {
        if (locked) return { error: { status: 409, code: "BATCH_LOCKED" as const } }
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
      if (body.concurrencyLimit !== undefined)
        data.concurrencyLimit = body.concurrencyLimit == null ? null : Math.floor(body.concurrencyLimit)
      if (body.rampUpSeconds !== undefined)
        data.rampUpSeconds = body.rampUpSeconds == null ? null : Math.floor(body.rampUpSeconds)
      if (body.autoMaxConcurrency !== undefined)
        data.autoMaxConcurrency = body.autoMaxConcurrency == null ? null : Math.floor(body.autoMaxConcurrency)
      if (body.failFast !== undefined) {
        if (locked) return { error: { status: 409, code: "BATCH_LOCKED" as const } }
        data.failFast = Boolean(body.failFast)
      }
      if (body.maxFailures !== undefined) {
        if (locked) return { error: { status: 409, code: "BATCH_LOCKED" as const } }
        data.maxFailures = body.maxFailures == null ? null : Math.floor(body.maxFailures)
      }

      if (body.urlFiles !== undefined) {
        if (locked) return { error: { status: 409, code: "BATCH_LOCKED" as const } }
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
                scriptEsm: s.scriptEsm ?? "",
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
            error: {
              status: 500,
              code: "WORKFLOW_INPUT_SPEC_INVALID" as const,
              meta: { field: "inputSpec" },
            },
          }
        }
        const inputSpec = specParsed.spec
        const urlFiles = normalizeUrlFilesForStorage(body.urlFiles)
        if (inputSpec?.filesInput?.urlFiles) {
          const enabled = inputSpec.filesInput.urlFiles.enabled !== false
          if (!enabled && urlFiles.length) {
            const issues: ApiIssue[] = [{ path: "/urlFiles", keyword: "disabled", params: { field: "urlFiles" } }]
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
                params: { limit: inputSpec.filesInput.urlFiles.maxItems },
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
      const b = await tx.batch.update({
        where: { id: existing.id },
        data,
        select: {
          publicId: true,
          publicNumber: true,
          name: true,
          status: true,
          workflow: { select: { publicId: true, publicNumber: true, name: true } },
          pinnedWorkflowVersion: { select: { version: true, createdAt: true, description: true } },
          concurrencyLimit: true,
          rampUpSeconds: true,
          autoMaxConcurrency: true,
          failFast: true,
          maxFailures: true,
          sourceJson: true,
          urlFilesJson: true,
          createdAt: true,
          startedAt: true,
          finishedAt: true,
          _count: { select: { jobRuns: true } },
        },
      })
      return { batch: b }
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

    const b = updated.batch
    return {
      ok: true as const,
      batch: {
        id: b.publicId,
        publicId: b.publicId,
        publicNumber: b.publicNumber,
        name: b.name,
        status: b.status,
        workflowId: b.workflow?.publicId ?? null,
        workflow: b.workflow
          ? {
              id: b.workflow.publicId,
              publicId: b.workflow.publicId,
              publicNumber: b.workflow.publicNumber,
              name: b.workflow.name,
            }
          : null,
        pinnedWorkflowVersion: b.pinnedWorkflowVersion
          ? {
              version: b.pinnedWorkflowVersion.version,
              createdAt: b.pinnedWorkflowVersion.createdAt,
              description: b.pinnedWorkflowVersion.description ?? null,
            }
          : null,
        concurrencyLimit: typeof b.concurrencyLimit === "number" ? b.concurrencyLimit : null,
        rampUpSeconds: typeof b.rampUpSeconds === "number" ? b.rampUpSeconds : null,
        autoMaxConcurrency: typeof b.autoMaxConcurrency === "number" ? b.autoMaxConcurrency : null,
        failFast: Boolean(b.failFast),
        maxFailures: typeof b.maxFailures === "number" ? b.maxFailures : null,
        sourceJson: b.sourceJson,
        urlFiles: parseStoredUrlFilesJson(b.urlFilesJson),
        jobsTotal: b._count.jobRuns,
        createdAt: b.createdAt,
        startedAt: b.startedAt,
        finishedAt: b.finishedAt,
      },
    }
  } catch {
    return { ok: false as const, status: 500, code: "UPDATE_FAILED" as const }
  }
}
