import { mark, withApiObservability } from "@/lib/server/observability"
import { runIdempotentOperation } from "@/lib/server/operations/run-operation"
import { notFound } from "@/lib/server/http/response"
import { requireRequestAuth } from "@/lib/server/authz"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { cancelRunByPublicId } from "@/lib/server/services/runs/cancel-run"
import { getRunByPublicId } from "@/lib/server/services/runs/get-run"

export const runtime = "nodejs"

export const POST = withApiObservability(async (req: Request, ctx: { params: Promise<{ runId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { runId } = await ctx.params
  const runPublicId = String(runId || "")
    .trim()
    .toLowerCase()
  const run = await getRunByPublicId({ viewerAuth, runId: runPublicId })
  if (!run) return notFound("RUN_NOT_FOUND")
  return await runIdempotentOperation({
    req,
    action: "RUN_CANCEL",
    scope: `runs:${runPublicId}:cancel`,
    targetType: "run",
    targetId: runPublicId,
    exec: async ({ operationId, operationInternalId: _operationInternalId }) => {
      let reason: string | null = null
      try {
        const ct = req.headers.get("content-type") || ""
        if (ct.includes("application/json")) {
          const body: unknown = await req.json().catch(() => null)
          if (body && typeof body === "object" && typeof (body as Record<string, unknown>).reason === "string") {
            reason = String((body as Record<string, unknown>).reason)
          }
        }
      } catch {
        reason = null
      }
      const canceled = await cancelRunByPublicId({ viewerAuth, runId: runPublicId, reason })
      if (!canceled.ok) return { status: 404, body: { code: "RUN_NOT_FOUND" } }
      mark("engine.cancel_requested")
      return { status: 200, body: { ok: true, operationId } }
    },
  })
})
