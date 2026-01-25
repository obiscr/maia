import { prisma } from "@/lib/server/db"
import { mark, withApiObservability } from "@/lib/server/observability"
import { ensureEngineRunning } from "@/lib/server/maia/server"
import { ensureWorkflowDepsInstalled } from "@/lib/server/maia/deps"
import { runIdempotentOperation } from "@/lib/server/operations/run-operation"
import { setOperationProgress, storeOperationResponse } from "@/lib/server/operations/operations"

export const runtime = "nodejs"

function envPositiveInt(name: string, fallback: number) {
  const raw = process.env[name]
  const n = raw == null ? NaN : Number(String(raw).trim())
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

export const POST = withApiObservability(async (req: Request, ctx: { params: Promise<{ workflowId: string }> }) => {
  const { workflowId } = await ctx.params
  const workflowPublicId = String(workflowId || "")
    .trim()
    .toLowerCase()
  return await runIdempotentOperation({
    req,
    action: "WORKFLOW_DEPS_INSTALL",
    scope: `workflows:${workflowPublicId}:deps:install`,
    targetType: "workflow",
    targetId: workflowPublicId,
    exec: async ({ operationId, operationInternalId }) => {
      await ensureEngineRunning()
      mark("engine")

      const wf = await prisma.workflow.findUnique({ where: { publicId: workflowPublicId }, select: { id: true } })
      if (!wf) return { status: 404, body: { code: "WORKFLOW_NOT_FOUND" } }

      // Fire-and-forget install so the API is platform-friendly (202 + poll via /api/operations/{id}).
      // Important: do NOT use req.signal because it is tied to the request lifecycle.
      const bgSignal = new AbortController().signal
      void (async () => {
        const heartbeatMs = envPositiveInt("OPS_OPERATION_HEARTBEAT_MS", 30_000)
        let timer: ReturnType<typeof setInterval> | null = null
        try {
          void setOperationProgress({
            operationId: operationInternalId,
            current: 0,
            total: null,
            messageKey: "operations.progressMessages.installingDeps",
          }).catch(() => {})
          timer = setInterval(() => {
            void setOperationProgress({
              operationId: operationInternalId,
              total: null,
              messageKey: "operations.progressMessages.installingDeps",
            }).catch(() => {})
          }, heartbeatMs)

          await ensureWorkflowDepsInstalled(wf.id, { signal: bgSignal })
          await storeOperationResponse({
            operationId: operationInternalId,
            reply: { status: 200, body: { ok: true, operationId } },
          })
        } catch (e) {
          await storeOperationResponse({
            operationId: operationInternalId,
            reply: { status: 500, body: { code: "DEPS_INSTALL_FAILED", operationId } },
            error: e,
          })
        } finally {
          if (timer) clearInterval(timer)
        }
      })()

      // 202 Accepted: operation remains RUNNING until background updates it to 200/500.
      return { status: 202, body: { ok: true, operationId } }
    },
  })
})
