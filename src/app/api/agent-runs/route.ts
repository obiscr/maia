import { z } from "zod"
import crypto from "node:crypto"

import { AgentRunType } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import { ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { zodIssues } from "@/lib/shared/http/zod"
import { fail } from "@/lib/server/http/response"
import { allocatePublicId } from "@/lib/server/public-ids"
import { runIdempotentOperation } from "@/lib/server/operations/run-operation"
import { ensureAgentEngineRunning } from "@/lib/server/agent/server"
import { requireRequestAuth } from "@/lib/server/authz"

export const runtime = "nodejs"

const createSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal(AgentRunType.WORKFLOW_ORCHESTRATE),
    workflowId: z.string().trim().min(1).optional(),
    locale: z.string().trim().min(2).max(16).default("en"),
    messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(10_000) })).min(1),
  }),
  z.object({
    type: z.literal(AgentRunType.WORKFLOW_INPUTSPEC),
    workflowId: z.string().trim().min(1),
    locale: z.string().trim().min(2).max(16).default("en"),
    instructions: z.string().trim().max(2000).optional(),
  }),
  z.object({
    type: z.literal(AgentRunType.WORKFLOW_OUTPUTSSPEC),
    workflowId: z.string().trim().min(1),
    locale: z.string().trim().min(2).max(16).default("en"),
    instructions: z.string().trim().max(2000).optional(),
  }),
])

export const POST = withApiObservability(async (req: Request) => {
  const auth = requireRequestAuth()
  let body: z.infer<typeof createSchema>
  try {
    body = createSchema.parse(await req.json().catch(() => ({})))
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    return fail({ status: 400, code: "INVALID_BODY" })
  }

  return await runIdempotentOperation({
    req,
    action: "AGENT_RUN_CREATE",
    scope: "agent",
    defaultAcceptedStatus: 202,
    exec: async ({ operationInternalId }) => {
      const created = await prisma.$transaction(async (tx) => {
        const pub = await allocatePublicId(tx, "agentRun")
        const id = crypto.randomUUID()

        const snapshot =
          body.type === AgentRunType.WORKFLOW_ORCHESTRATE
            ? {
                messages: body.messages,
                hasAssistantOutput: false,
                plan: null,
                proposal: null,
                stages: null,
                progress: null,
                draftSteps: [],
                updatedAt: new Date().toISOString(),
              }
            : {
                messages: [],
                hasAssistantOutput: false,
                plan: null,
                proposal: null,
                stages: null,
                progress: null,
                draftSteps: [],
                updatedAt: new Date().toISOString(),
              }

        const agentRun = await tx.agentRun.create({
          data: {
            id,
            publicId: pub.publicId,
            publicNumber: pub.publicNumber,
            type: body.type,
            status: "QUEUED",
            workflowId: ("workflowId" in body ? body.workflowId : null) ?? null,
            ownerUserId: auth.userId,
            createdByUserId: auth.userId,
            updatedByUserId: auth.userId,
            triggeredByUserId: auth.userId,
            operationId: operationInternalId,
            inputJson: JSON.stringify(body),
            snapshotJson: JSON.stringify(snapshot),
          },
          select: { id: true, publicId: true },
        })

        // Attach target to operation so it shows up in Operations UI.
        await tx.operation.update({
          where: { id: operationInternalId },
          data: { targetType: "agentRun", targetId: agentRun.publicId },
          select: { id: true },
        })

        return agentRun
      })

      // Kick the engine so it starts quickly.
      void ensureAgentEngineRunning({ tick: true }).catch(() => {})

      return { status: 202, body: { ok: true, agentRunId: created.publicId } }
    },
  })
})
