import "server-only"

import type { Prisma } from "@prisma/client"

import type { ViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { isAdminAuth } from "@/lib/server/scopes/viewer-scope"

export function getRunsListVisibilityWhere(auth: ViewerAuthContext): Prisma.RunWhereInput | undefined {
  return isAdminAuth(auth) ? undefined : { triggeredByUserId: auth.userId }
}

export function getRunFindFirstWhereByPublicId(auth: ViewerAuthContext, publicId: string): Prisma.RunWhereInput {
  const where: Prisma.RunWhereInput = { publicId }
  if (!isAdminAuth(auth)) where.triggeredByUserId = auth.userId
  return where
}
