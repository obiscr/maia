import "server-only"

import type { Prisma } from "@prisma/client"

import type { ViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { isAdminAuth } from "@/lib/server/scopes/viewer-scope"

export function getBatchesListVisibilityWhere(auth: ViewerAuthContext): Prisma.BatchWhereInput | undefined {
  return isAdminAuth(auth) ? undefined : { ownerUserId: auth.userId }
}

export function getBatchFindFirstWhereByPublicId(auth: ViewerAuthContext, publicId: string): Prisma.BatchWhereInput {
  const where: Prisma.BatchWhereInput = { publicId }
  if (!isAdminAuth(auth)) where.ownerUserId = auth.userId
  return where
}
