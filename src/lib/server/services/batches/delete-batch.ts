import "server-only"

import { prisma } from "@/lib/server/db"
import { getBatchFindFirstWhereByPublicId } from "@/lib/server/scopes/batches-scope"
import type { ViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export async function deleteBatchByPublicId(params: { viewerAuth: ViewerAuthContext; batchId: string }) {
  const batchPublicId = String(params.batchId || "")
    .trim()
    .toLowerCase()
  const existing = await prisma.batch.findFirst({
    where: getBatchFindFirstWhereByPublicId(params.viewerAuth, batchPublicId),
    select: { id: true },
  })
  if (!existing) return { ok: false as const, code: "NOT_FOUND" as const }
  await prisma.$transaction([
    prisma.jobRun.updateMany({ where: { batchId: existing.id }, data: { batchId: null } }),
    prisma.batch.delete({ where: { id: existing.id } }),
  ])
  return { ok: true as const }
}
