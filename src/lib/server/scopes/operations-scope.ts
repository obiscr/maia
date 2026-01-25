import "server-only"

import type { Prisma } from "@prisma/client"

import type { ViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { isAdminAuth } from "@/lib/server/scopes/viewer-scope"

export function actorForViewerPublicId(publicId: string): string {
  return `user:${publicId}`
}

export function getOperationsListVisibilityWhere(auth: ViewerAuthContext): Prisma.OperationWhereInput | undefined {
  return isAdminAuth(auth) ? undefined : { actor: actorForViewerPublicId(auth.viewer.publicId) }
}

export function getOperationFindFirstWhereByPublicId(
  auth: ViewerAuthContext,
  publicId: string,
): Prisma.OperationWhereInput {
  const where: Prisma.OperationWhereInput = { publicId }
  if (!isAdminAuth(auth)) where.actor = actorForViewerPublicId(auth.viewer.publicId)
  return where
}
