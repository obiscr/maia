import "server-only"

import crypto from "crypto"
import path from "path"
import fs from "fs/promises"

import type { Prisma } from "@prisma/client"
import { RunStatus } from "@prisma/client"

import { ensureDir } from "@/lib/server/maia/fs"
import { blobAbsPath, runDir } from "@/lib/server/maia/paths"
import { workflowSnapshotSchema } from "@/lib/server/maia/snapshot"
import { allocatePublicId } from "@/lib/server/public-ids"
import { isPlainObject } from "@/lib/shared/lang/is-plain-object"
import { sanitizeFilename } from "@/lib/server/maia/job-files"

function normalizeInitialInput(raw: unknown): Record<string, unknown> {
  if (isPlainObject(raw)) return raw
  return { value: raw }
}

type RunFileSnapshot =
  | {
      id: string
      name: string
      source: "upload"
      status: "ready"
      path: string
      sizeBytes?: number
      sha256?: string
      mime?: string
    }
  | {
      id: string
      name: string
      source: "url"
      url: string
      status: "fetching" | "failed" | "ready"
      path?: string
      sizeBytes?: number
      sha256?: string
      mime?: string
      error?: string
    }

async function materializeBlobToRunUpload(params: {
  runId: string
  inputFileId: string
  name: string
  blobSha256: string
}) {
  const safeName = sanitizeFilename(params.name || "file")
  const rel = path.join("uploads", `${params.inputFileId}-${safeName}`)
  const dest = path.join(runDir(params.runId), rel)
  await ensureDir(path.dirname(dest))

  const src = blobAbsPath(params.blobSha256)
  // Prefer hardlink (fast, no extra space) and fall back to copy.
  try {
    await fs.link(src, dest)
  } catch {
    try {
      await fs.copyFile(src, dest)
    } catch {
      // Best-effort; the step may fail if it tries to read.
    }
  }
  return rel
}

async function getLatestWorkflowVersion(tx: Prisma.TransactionClient, workflowId: string) {
  return await tx.workflowVersion.findFirst({
    where: { workflowId },
    orderBy: [{ version: "desc" }],
    select: { id: true, version: true, snapshotJson: true, createdAt: true },
  })
}

export async function createRunFromJobRun(tx: Prisma.TransactionClient, params: { jobRunId: string; now: Date }) {
  const job = await tx.jobRun.findUnique({ where: { id: params.jobRunId } })
  if (!job) throw new Error("JobRun not found")

  const workflow = await tx.workflow.findUnique({ where: { id: job.workflowId } })
  if (!workflow) throw new Error("Workflow not found")

  const version = job.pinnedWorkflowVersionId
    ? await tx.workflowVersion.findUnique({
        where: { id: job.pinnedWorkflowVersionId },
        select: { id: true, version: true, snapshotJson: true, createdAt: true },
      })
    : await getLatestWorkflowVersion(tx, workflow.id)
  if (!version) throw new Error("WorkflowVersion not found")

  const snapshot = workflowSnapshotSchema.parse(JSON.parse(version.snapshotJson || "{}"))

  let parsedInput: unknown = {}
  try {
    parsedInput = JSON.parse(job.inputJson || "{}")
  } catch {
    parsedInput = {}
  }
  const normalized = normalizeInitialInput(parsedInput)

  // SSOT: input files are stored in InputFile/InputBlob, not in job.inputJson.
  const inputFiles = await tx.inputFile.findMany({
    where: { jobRunId: job.id },
    orderBy: [{ createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      source: true,
      status: true,
      url: true,
      error: true,
      sha256: true,
      sizeBytes: true,
      mime: true,
      blob: { select: { sha256: true } },
    },
  })

  const runId = crypto.randomUUID()
  await ensureDir(runDir(runId))
  await ensureDir(path.join(runDir(runId), "uploads"))

  const runFiles: RunFileSnapshot[] = []
  for (const f of inputFiles) {
    const id = String(f.id)
    const name = String(f.name || "file")
    const source = String(f.source)
    const status = String(f.status)

    if (source === "UPLOAD") {
      if (status === "READY") {
        const sha = String(f.blob?.sha256 || f.sha256 || "")
        const rel = sha ? await materializeBlobToRunUpload({ runId, inputFileId: id, name, blobSha256: sha }) : ""
        runFiles.push({
          id,
          name,
          source: "upload",
          status: "ready",
          path: rel || path.join("uploads", `${id}-${sanitizeFilename(name || "file")}`),
          sizeBytes: typeof f.sizeBytes === "number" ? f.sizeBytes : undefined,
          sha256: sha || undefined,
          mime: typeof f.mime === "string" ? f.mime : undefined,
        })
      } else if (status === "FAILED") {
        // Upload inputs should usually never be FAILED, but keep a defensive snapshot.
        runFiles.push({
          id,
          name,
          source: "upload",
          status: "ready",
          path: path.join("uploads", `${id}-${sanitizeFilename(name || "file")}`),
        })
      }
      continue
    }

    if (source === "URL") {
      const url = typeof f.url === "string" ? f.url : ""
      if (status === "READY") {
        const sha = String(f.blob?.sha256 || f.sha256 || "")
        const rel = sha ? await materializeBlobToRunUpload({ runId, inputFileId: id, name, blobSha256: sha }) : ""
        runFiles.push({
          id,
          name,
          source: "url",
          url,
          status: "ready",
          path: rel || undefined,
          sizeBytes: typeof f.sizeBytes === "number" ? f.sizeBytes : undefined,
          sha256: sha || undefined,
          mime: typeof f.mime === "string" ? f.mime : undefined,
        })
      } else if (status === "FAILED") {
        runFiles.push({
          id,
          name,
          source: "url",
          url,
          status: "failed",
          error: typeof f.error === "string" ? f.error : "download failed",
        })
      } else {
        runFiles.push({
          id,
          name,
          source: "url",
          url,
          status: "fetching",
        })
      }
    }
  }

  if (runFiles.length) normalized.files = runFiles

  // Inputs are considered pending if any URL input is not READY (FETCHING/FAILED).
  const needsInputs = inputFiles.some((f) => f.source === "URL" && f.status !== "READY")
  const status = needsInputs ? RunStatus.PENDING_INPUTS : RunStatus.RUNNING

  const pub = await allocatePublicId(tx, "run")
  const run = await tx.run.create({
    data: {
      id: runId,
      publicId: pub.publicId,
      publicNumber: pub.publicNumber,
      workflowId: workflow.id,
      workflowVersionId: version.id,
      workflowVersionNumber: version.version,
      workflowName: snapshot.workflowName ?? workflow.name,
      workflowSnap: JSON.stringify(snapshot),
      status,
      initialInput: JSON.stringify(normalized ?? {}),
      ownerUserId: job.ownerUserId ?? job.triggeredByUserId ?? job.requestedByUserId ?? null,
      createdByUserId: job.createdByUserId ?? job.triggeredByUserId ?? job.requestedByUserId ?? null,
      updatedByUserId:
        job.updatedByUserId ?? job.createdByUserId ?? job.triggeredByUserId ?? job.requestedByUserId ?? null,
      triggeredByUserId: job.triggeredByUserId ?? job.requestedByUserId ?? null,
      startedAt: params.now,
      finishedAt: null,
    },
  })

  if (snapshot.steps?.length) {
    await tx.runStep.createMany({
      data: snapshot.steps.map((s) => ({
        id: crypto.randomUUID(),
        runId,
        stepKey: s.stepKey,
        name: s.name,
        status: "PENDING",
        depsJson: JSON.stringify(s.deps ?? []),
        scriptEsm: s.scriptEsm,
        timeoutMs: s.timeoutMs,
        retryPolicyJson: JSON.stringify(s.retryPolicy ?? {}),
        nextAttemptAt: null,
      })),
    })
  }

  // Record the effective pinned version for reproducibility.
  if (!job.pinnedWorkflowVersionId) {
    await tx.jobRun.update({
      where: { id: job.id },
      data: { pinnedWorkflowVersionId: version.id },
      select: { id: true },
    })
  }

  return run
}
