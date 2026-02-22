import "server-only"

import { z } from "zod"
import { generateText, Output, type UIMessage } from "ai"

import { createOpenRouterModel } from "@/lib/server/agent/openrouter"
import { ROUTER_MODEL } from "@/lib/server/agent/models"

export type ProfileId = "workflow.orchestrator" | "general.tools"

const routerSchema = z.object({
  profileId: z.enum(["workflow.orchestrator", "general.tools"]),
  requestedOutcome: z.enum(["workflow_definition", "state_query_or_action", "analysis_or_other"]),
  confidence: z.number().min(0).max(1),
})

export async function routeToProfile(params: {
  workflowId?: string | null
  messages: UIMessage[]
  apiKey: string
  model: string
  signal?: AbortSignal
}): Promise<ProfileId> {
  if (params.workflowId) return "workflow.orchestrator"

  const userMessages = params.messages.filter((m) => m.role === "user" || m.role === "assistant").slice(-8)

  if (!userMessages.length) return "general.tools"

  try {
    const routerModel = process.env.AGENT_ROUTER_MODEL ?? ROUTER_MODEL
    const routerAbort = new AbortController()
    const tmr = setTimeout(() => routerAbort.abort(), 10_000)
    params.signal?.addEventListener("abort", () => routerAbort.abort(), { once: true })

    try {
      const { output } = await generateText({
        model: createOpenRouterModel({ apiKey: params.apiKey, model: routerModel }),
        output: Output.object({ schema: routerSchema }),
        temperature: 0,
        abortSignal: routerAbort.signal,
        system: [
          "You are a profile router for Maia.",
          "Route by requested outcome type:",
          "- workflow_definition → workflow.orchestrator",
          "- state_query_or_action → general.tools",
          "- analysis_or_other → general.tools",
          "Be conservative: when unsure, choose general.tools.",
        ].join("\n"),
        prompt: JSON.stringify({
          messages: userMessages.map((m) => ({
            role: m.role,
            content: m.parts
              .filter((p): p is { type: "text"; text: string } => p.type === "text")
              .map((p) => p.text)
              .join(""),
          })),
        }),
      })

      if (!output) return "general.tools"

      if (
        output.requestedOutcome === "workflow_definition" ||
        (output.profileId === "workflow.orchestrator" && output.confidence >= 0.65)
      ) {
        return "workflow.orchestrator"
      }
      return "general.tools"
    } finally {
      clearTimeout(tmr)
    }
  } catch {
    return "general.tools"
  }
}
