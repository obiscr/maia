import { z } from "zod"

import { fail, ok } from "@/lib/server/http/response"
import { zodIssues } from "@/lib/shared/http/zod"
import { withApiObservability } from "@/lib/server/observability"
import { requireRequestAuth } from "@/lib/server/authz"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { listRuns, listRunsQuerySchema } from "@/lib/server/services/runs/list-runs"

export const runtime = "nodejs"

const getRunsQuerySchema = listRunsQuerySchema

export const GET = withApiObservability(async (req: Request) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  // NOTE: This endpoint is for listing. Avoid kicking the engine here to prevent extra DB contention.
  const url = new URL(req.url)
  let qp: z.infer<typeof getRunsQuerySchema>
  try {
    qp = getRunsQuerySchema.parse({
      q: url.searchParams.get("q") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
    })
  } catch (e) {
    if (e instanceof z.ZodError) {
      return fail({ status: 422, code: "INVALID_QUERY", issues: zodIssues(e) })
    }
    throw e
  }

  return ok(await listRuns({ viewerAuth, query: qp }))
})
