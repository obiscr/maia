import "server-only"

import type { Prisma } from "@prisma/client"

import type { ViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { isAdminAuth } from "@/lib/server/scopes/viewer-scope"

// NOTE: Member visibility for AgentRuns is currently based on createdByUserId.
// Keep this behavior stable (do not switch to ownerUserId without a migration/decision).
export function getAgentRunFindFirstWhereByPublicId(
  auth: ViewerAuthContext,
  publicId: string,
): Prisma.AgentRunWhereInput {
  const where: Prisma.AgentRunWhereInput = { publicId }
  if (!isAdminAuth(auth)) where.createdByUserId = auth.userId
  return where
}
