import { prisma } from "@/lib/server/db"
import { fail, notFound, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { WORKFLOW_EXPORT_FORMAT_V1 } from "@/lib/shared/workflow-import-export"

export const runtime = "nodejs"

function safeParseStringMap(raw: string | null | undefined): Record<string, string> {
  const txt = typeof raw === "string" ? raw : "{}"
  try {
    const obj = JSON.parse(txt)
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof v === "string") out[String(k)] = v
    }
    return out
  } catch {
    return {}
  }
}

function safeParseJsonValue(raw: string | null | undefined): unknown | null {
  if (typeof raw !== "string") return null
  const trimmed = raw.trim()
  if (!trimmed.length) return null
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return trimmed
  }
}

export const GET = withApiObservability(async (req: Request, ctx: { params: Promise<{ workflowId: string }> }) => {
  const { workflowId } = await ctx.params
  const url = new URL(req.url)
  const includeEnv = url.searchParams.get("includeEnv") === "1" || url.searchParams.get("includeEnv") === "true"

  const workflowPublicId = String(workflowId || "")
    .trim()
    .toLowerCase()

  const wf = await prisma.workflow.findUnique({
    where: { publicId: workflowPublicId },
    select: {
      id: true,
      publicId: true,
      name: true,
      description: true,
      dependencies: true,
      envJson: true,
      inputSpec: true,
      outputsSpec: true,
    },
  })
  if (!wf) return notFound("WORKFLOW_NOT_FOUND")

  const steps = await prisma.workflowStep.findMany({ where: { workflowId: wf.id }, orderBy: [{ key: "asc" }] })
  const deps = await prisma.workflowStepDep.findMany({ where: { workflowId: wf.id } })
  const depMap = new Map<string, string[]>()
  for (const d of deps) {
    const arr = depMap.get(d.stepId) ?? []
    arr.push(d.dependsOnStepId)
    depMap.set(d.stepId, arr)
  }

  const dependencies = safeParseStringMap(wf.dependencies)
  const env = includeEnv ? safeParseStringMap(wf.envJson) : {}
  const inputSpec = safeParseJsonValue(wf.inputSpec)
  const outputsSpec = safeParseJsonValue(wf.outputsSpec)

  return ok({
    format: WORKFLOW_EXPORT_FORMAT_V1,
    exportedAt: new Date().toISOString(),
    workflow: {
      id: wf.publicId,
      name: wf.name,
      description: wf.description ?? null,
    },
    version: null,
    flags: { envIncluded: includeEnv },
    data: {
      meta: {
        name: wf.name,
        description: wf.description ?? null,
      },
      steps: steps.map((s) => ({
        stepKey: s.key,
        name: s.name,
        scriptEsm: s.scriptEsm,
        timeoutMs: s.timeoutMs,
        deps: depMap.get(s.key) ?? [],
      })),
      env,
      dependencies,
      inputSpec,
      outputsSpec,
    },
  })
})
