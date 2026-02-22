import { z } from "zod"

import { fail, ok } from "@/lib/server/http/response"
import { zodIssues } from "@/lib/shared/http/zod"
import { withApiObservability } from "@/lib/server/observability"
import { runIdempotentOperation } from "@/lib/server/operations/run-operation"
import { requireRequestAuth } from "@/lib/server/authz"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { createBatch, createBatchSchema } from "@/lib/server/services/batches/create-batch"
import { listBatches, listBatchesQuerySchema } from "@/lib/server/services/batches/list-batches"

export const runtime = "nodejs"

const getBatchesQuerySchema = listBatchesQuerySchema

export const GET = withApiObservability(async (req: Request) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const url = new URL(req.url)
  let qp: z.infer<typeof getBatchesQuerySchema>
  try {
    qp = getBatchesQuerySchema.parse({
      q: url.searchParams.get("q") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
    })
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_QUERY", issues: zodIssues(e) })
    throw e
  }

  return ok(await listBatches({ viewerAuth, query: qp }))
})

export const POST = withApiObservability(async (req: Request) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  return await runIdempotentOperation({
    req,
    action: "BATCH_CREATE",
    scope: "batches:create",
    targetType: "batch",
    exec: async ({ operationId, operationInternalId: _operationInternalId }) => {
      let body: z.infer<typeof createBatchSchema>
      try {
        body = createBatchSchema.parse(await req.json())
      } catch (e) {
        if (e instanceof z.ZodError) return { status: 422, body: { code: "INVALID_BODY", issues: zodIssues(e) } }
        throw e
      }

      const created = await createBatch({ auth, viewerAuth, body })
      if (!created.ok) {
        return {
          status: created.status,
          body: { code: created.code, issues: created.issues, meta: created.meta },
        }
      }

      return {
        status: 201,
        headers: { Location: `/api/batches/${created.batchPublicId}` },
        body: {
          batch: {
            id: created.batchPublicId,
            publicId: created.batchPublicId,
            publicNumber: created.batchPublicNumber,
          },
          operationId,
        },
      }
    },
  })
})
