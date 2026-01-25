import { notFound, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { prisma } from "@/lib/server/db"
import { parseStoredReply } from "@/lib/server/operations/operations"
import { expandOperationTarget } from "@/lib/server/operations/expand-operation-target"
import type { ErrorEnvelope } from "@/lib/shared/error-display/types"
import { parseErrorLayer } from "@/lib/shared/error-display/parse-error-layer"
import { safeJsonParseStringNumberRecord } from "@/lib/shared/lang/safe-json"
import { safeJsonParseObject } from "@/lib/shared/lang/safe-json"

export const runtime = "nodejs"

function buildOperationErrorEnvelope(op: {
  errorCode: string | null
  errorMessage: string | null
  errorJson?: string | null
}): ErrorEnvelope | null {
  // Prefer structured errorJson if present (wrapper → root-cause chain).
  const parsed = safeJsonParseObject(op.errorJson ?? null)
  if (parsed && typeof parsed.code === "string") {
    const code = String(parsed.code ?? "UNKNOWN")
    const message = typeof parsed.message === "string" ? String(parsed.message) : null
    const layer = parseErrorLayer(parsed.layer) ?? "operation"
    const meta =
      parsed.meta && typeof parsed.meta === "object" && !Array.isArray(parsed.meta)
        ? (parsed.meta as Record<string, unknown>)
        : null
    const causesRaw = Array.isArray(parsed.causes) ? parsed.causes : null
    const normalize = (x: unknown): ErrorEnvelope | null => {
      if (!x || typeof x !== "object" || Array.isArray(x)) return null
      const o = x as Record<string, unknown>
      if (typeof o.code !== "string") return null
      const c = String(o.code ?? "UNKNOWN")
      const m = typeof o.message === "string" ? String(o.message) : null
      const l = parseErrorLayer(o.layer) ?? null
      const mt =
        o.meta && typeof o.meta === "object" && !Array.isArray(o.meta) ? (o.meta as Record<string, unknown>) : null
      const cr = Array.isArray(o.causes) ? (o.causes as unknown[]) : null
      const cs = cr ? (cr.map(normalize).filter(Boolean) as ErrorEnvelope[]) : null
      return { code: c, message: m, layer: l, meta: mt, causes: cs && cs.length ? cs : null }
    }
    const causes = causesRaw ? (causesRaw.map(normalize).filter(Boolean) as ErrorEnvelope[]) : null
    return { code, message, layer, meta, causes: causes && causes.length ? causes : null }
  }

  const code = op.errorCode ? String(op.errorCode) : null
  const message = op.errorMessage ? String(op.errorMessage) : null
  if (!code && !message) return null
  const msg = code && message && message.trim() === code.trim() ? null : message
  return { code: code ?? "UNKNOWN", message: msg ?? null, layer: "operation", meta: null, causes: null }
}

export const GET = withApiObservability(async (req: Request, ctx: { params: Promise<{ operationId: string }> }) => {
  const { operationId } = await ctx.params
  const operationPublicId = String(operationId || "")
    .trim()
    .toLowerCase()
  const url = new URL(req.url)
  const expand = new Set(
    (url.searchParams.get("expand") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  )

  const op = await prisma.operation.findUnique({ where: { publicId: operationPublicId } })
  if (!op) return notFound("OPERATION_NOT_FOUND")

  const stored = parseStoredReply({
    responseStatus: op.responseStatus,
    responseJson: op.responseJson,
    responseHeadersJson: op.responseHeadersJson,
  })

  return ok({
    operation: {
      // API/UI convention: `id` is the human-friendly public id (avoid leaking internal UUIDs).
      id: op.publicId,
      publicId: op.publicId,
      publicNumber: op.publicNumber,
      status: op.status,
      action: op.action,
      scope: op.scope,
      targetType: op.targetType,
      targetId: op.targetId,
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
      createdAt: op.createdAt,
      updatedAt: op.updatedAt,
      completedAt: op.completedAt,
      // Optional: useful for clients that want to get the same response without replaying the POST.
      result: stored ? { status: stored.status, body: stored.body, headers: stored.headers } : null,
      error: buildOperationErrorEnvelope({
        errorCode: op.errorCode ?? null,
        errorMessage: op.errorMessage ?? null,
        errorJson: op.errorJson ?? null,
      }),
    },
    target: expand.has("target")
      ? await expandOperationTarget({ targetType: op.targetType ?? null, targetId: op.targetId ?? null })
      : null,
  })
})
