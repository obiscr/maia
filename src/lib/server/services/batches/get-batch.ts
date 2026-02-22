import "server-only"

import { prisma } from "@/lib/server/db"
import { parseStoredUrlFilesJson } from "@/lib/server/maia/url-files"
import { getBatchFindFirstWhereByPublicId } from "@/lib/server/scopes/batches-scope"
import type { ViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export async function getBatchByPublicId(params: { viewerAuth: ViewerAuthContext; batchId: string }) {
  const batchPublicId = String(params.batchId || "")
    .trim()
    .toLowerCase()
  const batchRow = await prisma.batch.findFirst({
    where: getBatchFindFirstWhereByPublicId(params.viewerAuth, batchPublicId),
    select: { id: true },
  })
  if (!batchRow) return null
  const statusCounts = await prisma.jobRun.groupBy({
    by: ["status"],
    where: { batchId: batchRow.id },
    _count: { _all: true },
  })
  const jobsByStatus: Record<string, number> = {
    QUEUED: 0,
    PAUSED: 0,
    RUNNING: 0,
    SUCCEEDED: 0,
    FAILED: 0,
    CANCELED: 0,
  }
  for (const row of statusCounts) jobsByStatus[String(row.status)] = Number(row._count?._all ?? 0) || 0
  const batch = await prisma.batch.findUnique({
    where: { id: batchRow.id },
    select: {
      id: true,
      publicId: true,
      publicNumber: true,
      name: true,
      status: true,
      workflowId: true,
      workflow: { select: { publicId: true, publicNumber: true, name: true } },
      pinnedWorkflowVersion: { select: { version: true, createdAt: true, description: true } },
      concurrencyLimit: true,
      rampUpSeconds: true,
      autoMaxConcurrency: true,
      failFast: true,
      maxFailures: true,
      sourceJson: true,
      urlFilesJson: true,
      fanoutSeedJson: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
      _count: { select: { jobRuns: true } },
    },
  })
  if (!batch) return null
  return {
    id: batch.publicId,
    publicId: batch.publicId,
    publicNumber: batch.publicNumber,
    name: batch.name,
    status: batch.status,
    workflowId: batch.workflow?.publicId ?? null,
    workflow: batch.workflow
      ? {
          id: batch.workflow.publicId,
          publicId: batch.workflow.publicId,
          publicNumber: batch.workflow.publicNumber,
          name: batch.workflow.name,
        }
      : null,
    pinnedWorkflowVersion: batch.pinnedWorkflowVersion
      ? {
          version: batch.pinnedWorkflowVersion.version,
          createdAt: batch.pinnedWorkflowVersion.createdAt,
          description: batch.pinnedWorkflowVersion.description ?? null,
        }
      : null,
    concurrencyLimit: typeof batch.concurrencyLimit === "number" ? batch.concurrencyLimit : null,
    rampUpSeconds: typeof batch.rampUpSeconds === "number" ? batch.rampUpSeconds : null,
    autoMaxConcurrency: typeof batch.autoMaxConcurrency === "number" ? batch.autoMaxConcurrency : null,
    failFast: Boolean(batch.failFast),
    maxFailures: typeof batch.maxFailures === "number" ? batch.maxFailures : null,
    sourceJson: batch.sourceJson,
    urlFiles: parseStoredUrlFilesJson(batch.urlFilesJson),
    fanoutSeedJson: batch.fanoutSeedJson ?? null,
    jobsTotal: batch._count.jobRuns,
    jobsByStatus,
    createdAt: batch.createdAt,
    startedAt: batch.startedAt,
    finishedAt: batch.finishedAt,
  }
}
