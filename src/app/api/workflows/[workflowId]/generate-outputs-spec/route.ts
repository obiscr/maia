import { z } from "zod"

import { fail, notFound, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { requireRequestAuth } from "@/lib/server/authz"
import { prisma } from "@/lib/server/db"
import { getAgentSettingsForUser } from "@/lib/server/maia/agent-settings"
import { createOpenRouterModel } from "@/lib/server/agent/openrouter"
import { readWorkflowForAgent } from "@/lib/server/agent/workflow-context"
import { generateOutputsSpec } from "@/lib/server/chat/tools"
import { zodIssues } from "@/lib/shared/http/zod"

export const runtime = "nodejs"
export const maxDuration = 120

const bodySchema = z.object({
  locale: z.string().trim().min(2).max(16).default("en"),
  instructions: z.string().trim().max(2000).optional(),
})

export const POST = withApiObservability(async (req: Request, ctx: { params: Promise<{ workflowId: string }> }) => {
  const auth = requireRequestAuth()
  const { workflowId } = await ctx.params

  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(await req.json().catch(() => ({})))
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    return fail({ status: 400, code: "INVALID_BODY" })
  }

  const wf = await prisma.workflow.findUnique({ where: { publicId: workflowId }, select: { id: true } })
  if (!wf) return notFound("WORKFLOW_NOT_FOUND")

  const settings = await getAgentSettingsForUser(auth.userId, { touchApiKeyLastUsed: true })
  if (!settings.apiKey) return fail({ status: 422, code: "AGENT_API_KEY_MISSING" })

  const fullWf = await readWorkflowForAgent(wf.id)
  const draft: Record<string, unknown> = {
    name: fullWf.name,
    description: fullWf.description ?? "",
    dependencies: fullWf.dependencies ?? "{}",
    inputSpec: fullWf.inputSpec ?? "",
    outputsSpec: fullWf.outputsSpec ?? "",
    steps: fullWf.steps,
  }

  const model = createOpenRouterModel({ apiKey: settings.apiKey, model: settings.model })
  const outputsSpec = await generateOutputsSpec({ draft, locale: body.locale, model })

  if (!outputsSpec) return fail({ status: 500, code: "OUTPUTS_SPEC_GENERATION_FAILED" })

  await prisma.workflow.update({
    where: { id: wf.id },
    data: { outputsSpec },
    select: { id: true },
  })

  return ok({ outputsSpec })
})
