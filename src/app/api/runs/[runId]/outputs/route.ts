import path from "node:path"
import { AttemptStatus } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import { fail, notFound, ok } from "@/lib/server/http/response"
import { mark, withApiObservability } from "@/lib/server/observability"
import { workflowSnapshotSchema } from "@/lib/server/maia/snapshot"
import { readJsonFileOrNull } from "@/lib/server/maia/fs"
import { attemptDir } from "@/lib/server/maia/paths"
import { parseWorkflowOutputsSpec } from "@/lib/shared/maia/outputs-spec"
import { requireRequestAuth } from "@/lib/server/authz"
import { getRunFindFirstWhereByPublicId } from "@/lib/server/scopes/runs-scope"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export const runtime = "nodejs"

export const GET = withApiObservability(async (_: Request, ctx: { params: Promise<{ runId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { runId } = await ctx.params
  const runPublicId = String(runId || "")
    .trim()
    .toLowerCase()
  const run = await prisma.run.findFirst({
    where: getRunFindFirstWhereByPublicId(viewerAuth, runPublicId),
    select: { id: true, workflowSnap: true },
  })
  if (!run) return notFound("RUN_NOT_FOUND")
  const runInternalId = run.id

  let snap: ReturnType<typeof workflowSnapshotSchema.parse> | null = null
  try {
    snap = workflowSnapshotSchema.parse(JSON.parse(run.workflowSnap || "{}"))
  } catch {
    snap = null
  }
  const outputsSpecRaw = snap?.outputsSpec ?? null
  const parsed = parseWorkflowOutputsSpec(outputsSpecRaw)
  if (!parsed.spec) {
    return ok({
      outputs: null,
      spec: null,
      error: parsed.error ?? null,
      reservedInitialInputKeys: snap?.reservedInitialInputKeys ?? null,
    })
  }

  const spec = parsed.spec
  const out: Record<string, unknown> = {}
  const sources: Record<string, { stepKey: string; field?: string; attemptNo: number | null }> = {}

  for (const [name, def] of Object.entries(spec.outputs ?? {})) {
    const stepKey = String(def?.stepKey ?? "").trim()
    const field = def?.field ? String(def.field).trim() : undefined
    if (!stepKey) {
      out[name] = null
      sources[name] = { stepKey: "", field, attemptNo: null }
      continue
    }

    const last = await prisma.attempt.findFirst({
      where: { runId: runInternalId, stepKey, status: AttemptStatus.SUCCEEDED },
      orderBy: [{ attemptNo: "desc" }],
      select: { attemptNo: true },
    })
    if (!last) {
      out[name] = null
      sources[name] = { stepKey, field, attemptNo: null }
      continue
    }

    const p = path.join(attemptDir(runInternalId, stepKey, last.attemptNo), "output.json")
    const json = await readJsonFileOrNull<any>(p)
    const outputsObj = json?.data?.outputs
    out[name] = field ? (outputsObj?.[field] ?? null) : (outputsObj ?? null)
    sources[name] = { stepKey, field, attemptNo: last.attemptNo }
  }

  mark("outputs")
  return ok({ outputs: out, spec, sources, reservedInitialInputKeys: snap?.reservedInitialInputKeys ?? null })
})
