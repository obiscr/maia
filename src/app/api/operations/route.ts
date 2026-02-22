import { z } from "zod"
import { fail, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { zodIssues } from "@/lib/shared/http/zod"
import { requireRequestAuth } from "@/lib/server/authz"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { listOperations, listOperationsQuerySchema } from "@/lib/server/services/operations/list-operations"

export const runtime = "nodejs"

const getOperationsQuerySchema = listOperationsQuerySchema

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

  return ok(await listOperations({ viewerAuth, query: qp }))
})
