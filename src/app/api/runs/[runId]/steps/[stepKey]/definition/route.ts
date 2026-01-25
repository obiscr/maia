import { prisma } from "@/lib/server/db"
import { ok } from "@/lib/server/http/response"
import { mark, withApiObservability } from "@/lib/server/observability"
import { requireRequestAuth } from "@/lib/server/authz"
import { getRunFindFirstWhereByPublicId } from "@/lib/server/scopes/runs-scope"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { safeJsonParseObject, safeJsonParseStringArray } from "@/lib/shared/lang/safe-json"

export const runtime = "nodejs"

function safeDependenciesCountFromSnapshot(snap: Record<string, unknown> | null): number | null {
  const raw = snap && typeof snap.dependencies === "string" ? String(snap.dependencies) : null
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    return Object.keys(parsed as Record<string, unknown>).length
  } catch {
    return null
  }
}

export const GET = withApiObservability(
  async (_: Request, ctx: { params: Promise<{ runId: string; stepKey: string }> }) => {
    const auth = requireRequestAuth()
    const viewerAuth = toViewerAuthContext(auth)
    const { runId, stepKey } = await ctx.params
    const runPublicId = String(runId || "")
      .trim()
      .toLowerCase()

    const run = await prisma.run.findFirst({
      where: getRunFindFirstWhereByPublicId(viewerAuth, runPublicId),
      select: {
        id: true,
        workflowId: true,
        workflowName: true,
        workflowSnap: true,
        workflowVersionNumber: true,
        workflow: { select: { publicId: true } },
      },
    })
    if (!run) return ok({ available: false, code: "RUN_NOT_FOUND", run: null, step: null })
    mark("db.run")

    const runStep = await prisma.runStep.findUnique({
      where: { runId_stepKey: { runId: run.id, stepKey } },
      select: {
        stepKey: true,
        name: true,
        depsJson: true,
        timeoutMs: true,
        scriptEsm: true,
      },
    })
    if (!runStep) return ok({ available: false, code: "NO_STEP_DEFINITION", run: null, step: null })
    mark("db.runStep")

    const snap = safeJsonParseObject(run.workflowSnap)
    const depsHash = typeof snap?.depsHash === "string" ? snap.depsHash : null
    const depsPackagesCount = safeDependenciesCountFromSnapshot(snap)

    return ok({
      available: true,
      code: null,
      run: {
        id: runPublicId,
        // Avoid leaking internal UUIDs (workflowId/workflowVersionId are internal).
        workflowId: run.workflow?.publicId ?? null,
        workflowName: run.workflowName,
        workflowVersionNumber: run.workflowVersionNumber ?? null,
        depsHash,
        depsPackagesCount,
      },
      step: {
        stepKey: runStep.stepKey,
        name: runStep.name,
        deps: safeJsonParseStringArray(runStep.depsJson),
        timeoutMs: runStep.timeoutMs,
        scriptEsm: runStep.scriptEsm ?? "",
      },
    })
  },
)
