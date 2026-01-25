import "server-only"

import type { Prisma } from "@prisma/client"

import type { ViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { isAdminAuth } from "@/lib/server/scopes/viewer-scope"

export function getJobRunsListVisibilityWhere(auth: ViewerAuthContext): Prisma.JobRunWhereInput | undefined {
  return isAdminAuth(auth) ? undefined : { requestedByUserId: auth.userId }
}

export function getJobRunFindFirstWhereByPublicId(auth: ViewerAuthContext, publicId: string): Prisma.JobRunWhereInput {
  const where: Prisma.JobRunWhereInput = { publicId }
  if (!isAdminAuth(auth)) where.requestedByUserId = auth.userId
  return where
}
