import "server-only"

import { prisma } from "@/lib/server/db"
import { emitScheduleDeleted } from "@/lib/server/maia/realtime"
import { getScheduleFindFirstWhereByPublicId } from "@/lib/server/scopes/schedules-scope"
import type { ViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export async function deleteScheduleByPublicId(params: { viewerAuth: ViewerAuthContext; scheduleId: string }) {
  const schedulePublicId = String(params.scheduleId || "")
    .trim()
    .toLowerCase()
  const existing = await prisma.schedule.findFirst({
    where: getScheduleFindFirstWhereByPublicId(params.viewerAuth, schedulePublicId),
    select: { id: true, publicId: true, ownerUser: { select: { publicId: true } } },
  })
  if (!existing) return { ok: false as const, code: "NOT_FOUND" as const }

  await prisma.$transaction([
    prisma.jobRun.updateMany({ where: { scheduleId: existing.id }, data: { scheduleId: null } }),
    prisma.schedule.delete({ where: { id: existing.id } }),
  ])
  await emitScheduleDeleted({
    scheduleId: existing.publicId,
    ownerUserPublicId: existing.ownerUser?.publicId ?? null,
  }).catch(() => {})
  return { ok: true as const }
}
