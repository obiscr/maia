import { fail, notFound, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { z } from "zod"
import { zodIssues } from "@/lib/shared/http/zod"
import { requireRequestAuth } from "@/lib/server/authz"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { deleteBatchByPublicId } from "@/lib/server/services/batches/delete-batch"
import { getBatchByPublicId } from "@/lib/server/services/batches/get-batch"
import { patchBatchByPublicId, patchBatchSchema } from "@/lib/server/services/batches/patch-batch"

export const runtime = "nodejs"

export const GET = withApiObservability(async (_req: Request, ctx: { params: Promise<{ batchId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { batchId } = await ctx.params
  const batch = await getBatchByPublicId({ viewerAuth, batchId })
  if (!batch) return notFound("NOT_FOUND")
  return ok({ batch })
})

export const PATCH = withApiObservability(async (req: Request, ctx: { params: Promise<{ batchId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { batchId } = await ctx.params
  let body: z.infer<typeof patchBatchSchema>
  try {
    body = patchBatchSchema.parse(await req.json())
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    throw e
  }

  const updated = await patchBatchByPublicId({ auth, viewerAuth, batchId, body })
  if (!updated.ok) {
    if (updated.status === 404) return notFound("NOT_FOUND")
    return fail({ status: updated.status, code: updated.code, issues: updated.issues, meta: updated.meta })
  }
  return ok({ batch: updated.batch })
})

export const DELETE = withApiObservability(async (_req: Request, ctx: { params: Promise<{ batchId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { batchId } = await ctx.params
  const deleted = await deleteBatchByPublicId({ viewerAuth, batchId })
  if (!deleted.ok) return notFound("NOT_FOUND")
  return ok({ ok: true })
})
