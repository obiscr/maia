import { z } from "zod"
import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import { fail, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { zodIssues } from "@/lib/shared/http/zod"
import { requireRequestAuth } from "@/lib/server/authz"
import { getOperationsListVisibilityWhere } from "@/lib/server/scopes/operations-scope"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { safeJsonParseStringNumberRecord } from "@/lib/shared/lang/safe-json"

export const runtime = "nodejs"

const getOperationsQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(["PENDING", "RUNNING", "SUCCEEDED", "FAILED"]).optional(),
  action: z.string().trim().min(1).max(100).optional(),
  targetId: z.string().trim().min(1).max(200).optional(),
  targetType: z.string().trim().min(1).max(50).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(["CREATED_DESC", "CREATED_ASC"]).default("CREATED_DESC"),
})

export const GET = withApiObservability(async (req: Request) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const url = new URL(req.url)
  let qp: z.infer<typeof getOperationsQuerySchema>
  try {
    qp = getOperationsQuerySchema.parse({
      q: url.searchParams.get("q") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      action: url.searchParams.get("action") ?? undefined,
      targetId: url.searchParams.get("targetId") ?? undefined,
      targetType: url.searchParams.get("targetType") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
    })
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_QUERY", issues: zodIssues(e) })
    throw e
  }

  const andParts: Prisma.OperationWhereInput[] = []
  const visibilityWhere = getOperationsListVisibilityWhere(viewerAuth)
  if (visibilityWhere) andParts.push(visibilityWhere)
  if (qp.status) andParts.push({ status: qp.status })
  if (qp.action) andParts.push({ action: qp.action })
  if (qp.targetId) andParts.push({ targetId: qp.targetId })
  if (qp.targetType) andParts.push({ targetType: qp.targetType })

  if (qp.q && qp.q.length) {
    andParts.push({
      OR: [
        { publicId: { contains: qp.q } },
        { action: { contains: qp.q } },
        { targetId: { contains: qp.q } },
        { requestId: { contains: qp.q } },
      ],
    })
  }

  const where = andParts.length ? { AND: andParts } : undefined
  const orderBy = qp.sort === "CREATED_ASC" ? [{ createdAt: "asc" as const }] : [{ createdAt: "desc" as const }]

  const total = await prisma.operation.count({ where })
  const ops = await prisma.operation.findMany({
    where,
    orderBy,
    skip: (qp.page - 1) * qp.pageSize,
    take: qp.pageSize,
    select: {
      id: true,
      publicId: true,
      publicNumber: true,
      status: true,
      action: true,
      scope: true,
      targetType: true,
      targetId: true,
      actor: true,
      tenantId: true,
      requestId: true,
      progressCurrent: true,
      progressTotal: true,
      progressMessageKey: true,
      progressMessageParamsJson: true,
      responseStatus: true,
      errorCode: true,
      errorMessage: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  return ok({
    total,
    operations: (ops ?? []).map((op) => ({
      id: op.publicId,
      publicId: op.publicId,
      publicNumber: op.publicNumber,
      status: op.status,
      action: op.action,
      scope: op.scope ?? null,
      targetType: op.targetType ?? null,
      targetId: op.targetId ?? null,
      audit: {
        actor: op.actor ?? null,
        tenantId: op.tenantId ?? null,
        requestId: op.requestId ?? null,
      },
      progress: {
        current: op.progressCurrent ?? 0,
        total: op.progressTotal ?? null,
        messageKey: op.progressMessageKey ?? null,
        messageParams: safeJsonParseStringNumberRecord(op.progressMessageParamsJson) ?? null,
      },
      responseStatus: typeof op.responseStatus === "number" ? op.responseStatus : null,
      errorCode: op.errorCode ?? null,
      errorMessage: op.errorMessage ?? null,
      createdAt: op.createdAt,
      updatedAt: op.updatedAt,
      completedAt: op.completedAt ?? null,
    })),
    page: qp.page,
    pageSize: qp.pageSize,
    sort: qp.sort,
    q: qp.q ?? "",
    status: qp.status ?? null,
    action: qp.action ?? null,
    targetType: qp.targetType ?? null,
    targetId: qp.targetId ?? null,
  })
})
