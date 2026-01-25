import "server-only"

import { notFound } from "next/navigation"

import { prisma } from "@/lib/server/db"
import type { PublicIdKind } from "@/lib/server/public-ids"
import { looksLikePublicId } from "@/lib/shared/format/id"

export function normalizePublicIdParam(raw: string): string | null {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase()
  if (!v) return null
  if (!looksLikePublicId(v)) return null
  return v
}

export async function requirePublicResource(kind: PublicIdKind, rawPublicId: string): Promise<string> {
  const publicId = normalizePublicIdParam(rawPublicId)
  if (!publicId) notFound()

  const exists = await (async () => {
    if (kind === "workflow") return prisma.workflow.findUnique({ where: { publicId }, select: { id: true } })
    if (kind === "run") return prisma.run.findUnique({ where: { publicId }, select: { id: true } })
    if (kind === "job") return prisma.jobRun.findUnique({ where: { publicId }, select: { id: true } })
    if (kind === "schedule") return prisma.schedule.findUnique({ where: { publicId }, select: { id: true } })
    if (kind === "batch") return prisma.batch.findUnique({ where: { publicId }, select: { id: true } })
    if (kind === "operation") return prisma.operation.findUnique({ where: { publicId }, select: { id: true } })
    return null
  })()

  if (!exists) notFound()
  return publicId
}

export async function requireWorkflowVersion(params: {
  rawWorkflowId: string
  rawVersion: string
}): Promise<{ workflowPublicId: string; workflowInternalId: string; version: number }> {
  const workflowPublicId = await requirePublicResource("workflow", params.rawWorkflowId)
  const wf = await prisma.workflow.findUnique({ where: { publicId: workflowPublicId }, select: { id: true } })
  if (!wf) notFound()

  const version = (() => {
    const n = Number.parseInt(String(params.rawVersion ?? ""), 10)
    return Number.isFinite(n) && n > 0 ? n : NaN
  })()
  if (!Number.isFinite(version)) notFound()

  const row = await prisma.workflowVersion.findUnique({
    where: { workflowId_version: { workflowId: wf.id, version } },
    select: { id: true },
  })
  if (!row) notFound()

  return { workflowPublicId, workflowInternalId: wf.id, version }
}
