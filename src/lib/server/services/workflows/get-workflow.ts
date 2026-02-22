import "server-only"

import { prisma } from "@/lib/server/db"
import { getWorkflowFindFirstWhereByPublicId } from "@/lib/server/scopes/workflows-scope"
import type { ViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export async function getWorkflowByPublicId(params: { viewerAuth: ViewerAuthContext; workflowId: string }) {
  const workflowPublicId = String(params.workflowId || "")
    .trim()
    .toLowerCase()
  const wf = await prisma.workflow.findFirst({
    where: getWorkflowFindFirstWhereByPublicId(params.viewerAuth, workflowPublicId),
  })
  if (!wf) return null

  const steps = await prisma.workflowStep.findMany({ where: { workflowId: wf.id }, orderBy: [{ key: "asc" }] })
  const deps = await prisma.workflowStepDep.findMany({ where: { workflowId: wf.id } })
  const depMap = new Map<string, string[]>()
  for (const d of deps) {
    const arr = depMap.get(d.stepId) ?? []
    arr.push(d.dependsOnStepId)
    depMap.set(d.stepId, arr)
  }

  return {
    id: wf.publicId,
    publicId: wf.publicId,
    publicNumber: wf.publicNumber,
    name: wf.name,
    description: wf.description,
    dependencies: wf.dependencies,
    envJson: wf.envJson,
    inputSpec: wf.inputSpec,
    outputsSpec: wf.outputsSpec,
    depsHash: wf.depsHash,
    depsStatus: wf.depsStatus,
    depsErrorCode: wf.depsErrorCode,
    depsErrorMessage: wf.depsErrorMessage,
    depsErrorMetaJson: wf.depsErrorMetaJson,
    depsErrorAt: wf.depsErrorAt,
    depsUpdatedAt: wf.depsUpdatedAt,
    createdAt: wf.createdAt,
    updatedAt: wf.updatedAt,
    steps: steps.map((s) => ({
      stepKey: s.key,
      name: s.name,
      description: s.description,
      scriptEsm: s.scriptEsm,
      timeoutMs: s.timeoutMs,
      retryPolicy: (() => {
        try {
          return s.retryPolicyJson ? JSON.parse(String(s.retryPolicyJson)) : undefined
        } catch {
          return undefined
        }
      })(),
      deps: depMap.get(s.key) ?? [],
    })),
  }
}
