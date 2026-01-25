import { z } from "zod"

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: unknown[] }
  | { role: "tool"; tool_call_id: string; content: string }

export type ToolDef = {
  type: "function"
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export type AgentSend = (event: string, data: unknown) => void

export type AgentContext = {
  locale: string
  workflowId?: string
}

export type AgentRuntimeContext = AgentContext & {
  signal: AbortSignal
}

export type AgentDefinition<TBody> = {
  id: string
  requestSchema: z.ZodType<TBody>
  /**
   * Default tool surface for the agent. Most agents can keep this static.
   */
  tools: ToolDef[]
  /**
   * Optional orchestrator hook: dynamically choose tools per round.
   * This enables "two-pass" flows (plan-only → draft-only) to make UI + agent behavior deterministic.
   */
  getTools?: (state: { phase: "plan" | "draft" }) => ToolDef[]
  buildHistory: (params: { body: TBody; ctx: AgentRuntimeContext }) => Promise<ChatMessage[]>
  runTool: (params: { name: string; args: unknown; ctx: AgentRuntimeContext }) => Promise<unknown>
  onToolResult?: (params: { name: string; result: unknown; send: AgentSend }) => void
  /**
   * Optional orchestrator hook: declare a tool result as terminal for this request.
   * If it returns true, the server will stop calling the model, emit `done`, and close the SSE stream.
   *
   * This is useful for "proposal" style agents where a specific validation tool call yields the final payload.
   */
  isTerminalToolResult?: (params: { name: string; result: unknown }) => boolean
  /**
   * Optional hook after each assistant delta chunk is emitted. Most agents don't need this.
   */
  onDelta?: (params: { delta: string; send: AgentSend }) => void
}
