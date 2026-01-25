import "server-only"

import type { Prisma } from "@prisma/client"

import type { ViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { isAdminAuth } from "@/lib/server/scopes/viewer-scope"

export function getSchedulesListVisibilityWhere(auth: ViewerAuthContext): Prisma.ScheduleWhereInput | undefined {
  return isAdminAuth(auth) ? undefined : { ownerUserId: auth.userId }
}

export function getScheduleFindFirstWhereByPublicId(
  auth: ViewerAuthContext,
  publicId: string,
): Prisma.ScheduleWhereInput {
  const where: Prisma.ScheduleWhereInput = { publicId }
  if (!isAdminAuth(auth)) where.ownerUserId = auth.userId
  return where
}
