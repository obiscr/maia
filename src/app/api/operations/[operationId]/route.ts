import { notFound, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { requireRequestAuth } from "@/lib/server/authz"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { getOperationByPublicId } from "@/lib/server/services/operations/get-operation"

export const runtime = "nodejs"

export const GET = withApiObservability(async (req: Request, ctx: { params: Promise<{ operationId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { operationId } = await ctx.params
  const url = new URL(req.url)
  const expand = new Set(
    (url.searchParams.get("expand") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  )
  const result = await getOperationByPublicId({
    viewerAuth,
    operationId,
    expandTarget: expand.has("target"),
  })
  if (!result) return notFound("OPERATION_NOT_FOUND")
  return ok(result)
})
