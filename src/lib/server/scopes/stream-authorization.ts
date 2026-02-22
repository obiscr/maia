import "server-only"

import { prisma } from "@/lib/server/db"
import type { RequestAuthContext } from "@/lib/server/authz"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { isListStreamTopicKind, parseListStreamTopicId } from "@/lib/shared/realtime/topics"
import type { StreamTopic } from "@/lib/shared/realtime/topics"
import { getRunFindFirstWhereByPublicId } from "@/lib/server/scopes/runs-scope"
import { getJobRunFindFirstWhereByPublicId } from "@/lib/server/scopes/jobs-scope"
import { getBatchFindFirstWhereByPublicId } from "@/lib/server/scopes/batches-scope"
import { getScheduleFindFirstWhereByPublicId } from "@/lib/server/scopes/schedules-scope"
import { getOperationFindFirstWhereByPublicId } from "@/lib/server/scopes/operations-scope"
import { getWorkflowFindFirstWhereById, getWorkflowFindFirstWhereByPublicId } from "@/lib/server/scopes/workflows-scope"

export type ParsedStreamTopic = {
  topic: StreamTopic
  kind: string
  id: string
}

export class StreamAuthorizationError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = "StreamAuthorizationError"
    this.status = status
  }
}

function forbidden() {
  return new StreamAuthorizationError(403, "Forbidden")
}

export async function assertCanSubscribe(auth: RequestAuthContext, parsed: ParsedStreamTopic): Promise<void> {
  const a = toViewerAuthContext(auth)
  const admin = a.viewer.role === "ADMIN"

  const list = parseListStreamTopicId(parsed.id)
  const kind = String(parsed.kind || "").trim()

  // List topics follow the `list_admin` / `list_<userPublicId>` convention.
  if (isListStreamTopicKind(kind)) {
    if (!list) {
      // Protect against malformed list topics for non-admins.
      if (!admin) throw forbidden()
      return
    }
    if (list.scope === "admin") {
      if (!admin) throw forbidden()
      return
    }
    // user-scoped list
    if (!admin && String(list.userPublicId) !== String(a.viewer.publicId)) throw forbidden()
    return
  }

  // Resource topics.
  if (admin) return

  if (kind === "run") {
    const ok = await prisma.run
      .findFirst({ where: getRunFindFirstWhereByPublicId(a, parsed.id), select: { id: true } })
      .then(Boolean)
      .catch(() => false)
    if (!ok) throw forbidden()
    return
  }

  if (kind === "job") {
    const ok = await prisma.jobRun
      .findFirst({ where: getJobRunFindFirstWhereByPublicId(a, parsed.id), select: { id: true } })
      .then(Boolean)
      .catch(() => false)
    if (!ok) throw forbidden()
    return
  }

  if (kind === "batch") {
    const ok = await prisma.batch
      .findFirst({ where: getBatchFindFirstWhereByPublicId(a, parsed.id), select: { id: true } })
      .then(Boolean)
      .catch(() => false)
    if (!ok) throw forbidden()
    return
  }

  if (kind === "schedule") {
    const ok = await prisma.schedule
      .findFirst({ where: getScheduleFindFirstWhereByPublicId(a, parsed.id), select: { id: true } })
      .then(Boolean)
      .catch(() => false)
    if (!ok) throw forbidden()
    return
  }

  if (kind === "operation") {
    const ok = await prisma.operation
      .findFirst({ where: getOperationFindFirstWhereByPublicId(a, parsed.id), select: { id: true } })
      .then(Boolean)
      .catch(() => false)
    if (!ok) throw forbidden()
    return
  }

  if (kind === "workflowDeps") {
    const ok = await prisma.workflow
      .findFirst({
        where: {
          OR: [getWorkflowFindFirstWhereByPublicId(a, parsed.id), getWorkflowFindFirstWhereById(a, parsed.id)],
        },
        select: { id: true },
      })
      .then(Boolean)
      .catch(() => false)
    if (!ok) throw forbidden()
    return
  }
}
