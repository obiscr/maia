import "server-only"

import crypto from "node:crypto"
import { z } from "zod"

import { prisma } from "@/lib/server/db"
import type { RequestAuthContext } from "@/lib/server/authz"
import type { ViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { getWorkflowFindFirstWhereById, getWorkflowFindFirstWhereByPublicId } from "@/lib/server/scopes/workflows-scope"
import { parseWorkflowInputSpecWithOpts } from "@/lib/shared/maia/input-spec"
import type { ApiIssue } from "@/lib/shared/http/types"
import { workflowSnapshotSchema } from "@/lib/server/maia/snapshot"
import { getLatestWorkflowVersion } from "@/lib/server/maia/workflow-versioning"
import { normalizeUrlFilesForStorage } from "@/lib/server/maia/url-files"
import { isRecord } from "@/lib/shared/lang/is-record"
import { allocatePublicId } from "@/lib/server/public-ids"
import { makeCreateAudit } from "@/lib/server/audit/write"

export const createBatchSchema = z.object({
  name: z.string().trim().max(200).optional().default(""),
  workflowId: z.string().min(1),
  pinnedWorkflowVersionNumber: z.coerce.number().int().min(1).nullable().optional(),
  concurrencyLimit: z.coerce.number().int().min(1).max(10_000).nullable().optional(),
  rampUpSeconds: z.coerce.number().int().min(1).max(86_400).nullable().optional(),
  autoMaxConcurrency: z.coerce.number().int().min(1).max(10_000).nullable().optional(),
  failFast: z.coerce.boolean().optional().default(false),
  maxFailures: z.coerce.number().int().min(1).max(10_000).nullable().optional(),
  sourceJson: z.unknown().optional().default({}),
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

export async function createBatch(params: {
  auth: RequestAuthContext
  viewerAuth: ViewerAuthContext
  body: z.infer<typeof createBatchSchema>
}) {
  const body = params.body
  const workflowPublicId = String(body.workflowId || "")
    .trim()
    .toLowerCase()
  const workflow =
    (await prisma.workflow.findFirst({
      where: getWorkflowFindFirstWhereByPublicId(params.viewerAuth, workflowPublicId),
    })) ??
    (await prisma.workflow.findFirst({ where: getWorkflowFindFirstWhereById(params.viewerAuth, body.workflowId) }))
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
  const urlFiles = normalizeUrlFilesForStorage(body.urlFiles)
  if (inputSpec?.filesInput?.urlFiles) {
    const enabled = inputSpec.filesInput.urlFiles.enabled !== false
    if (!enabled && urlFiles.length) {
      const issues: ApiIssue[] = [{ path: "/urlFiles", keyword: "disabled", params: { field: "urlFiles" } }]
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

  const source = isRecord(body.sourceJson) ? body.sourceJson : { value: body.sourceJson }
  const pub = await allocatePublicId(prisma, "batch")
  const batch = await prisma.batch.create({
    data: {
      id: crypto.randomUUID(),
      publicId: pub.publicId,
      publicNumber: pub.publicNumber,
      name: body.name?.trim() ? body.name.trim() : null,
      workflowId: workflow.id,
      ...makeCreateAudit(params.auth),
      status: "CREATED",
      pinnedWorkflowVersionId,
      concurrencyLimit: body.concurrencyLimit == null ? null : Math.floor(body.concurrencyLimit),
      rampUpSeconds: body.rampUpSeconds == null ? null : Math.floor(body.rampUpSeconds),
      autoMaxConcurrency: body.autoMaxConcurrency == null ? null : Math.floor(body.autoMaxConcurrency),
      failFast: Boolean(body.failFast),
      maxFailures: body.maxFailures == null ? null : Math.floor(body.maxFailures),
      sourceJson: JSON.stringify(source ?? {}),
      urlFilesJson: JSON.stringify(urlFiles),
    },
    select: { publicId: true, publicNumber: true },
  })

  return { ok: true as const, batchPublicId: batch.publicId, batchPublicNumber: batch.publicNumber }
}
