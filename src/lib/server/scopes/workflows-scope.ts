import "server-only"

import type { Prisma } from "@prisma/client"

import type { ViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { isAdminAuth } from "@/lib/server/scopes/viewer-scope"

export function getWorkflowsListVisibilityWhere(auth: ViewerAuthContext): Prisma.WorkflowWhereInput | undefined {
  return isAdminAuth(auth) ? undefined : { ownerUserId: auth.userId }
}

export function getWorkflowFindFirstWhereByPublicId(
  auth: ViewerAuthContext,
  publicId: string,
): Prisma.WorkflowWhereInput {
  const where: Prisma.WorkflowWhereInput = { publicId }
  if (!isAdminAuth(auth)) where.ownerUserId = auth.userId
  return where
}

export function getWorkflowFindFirstWhereById(auth: ViewerAuthContext, id: string): Prisma.WorkflowWhereInput {
  const where: Prisma.WorkflowWhereInput = { id }
  if (!isAdminAuth(auth)) where.ownerUserId = auth.userId
  return where
}
