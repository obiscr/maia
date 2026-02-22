import "server-only"

import type { ZodType } from "zod"

import type { RequestAuthContext } from "@/lib/server/authz"
import type { ViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export type ToolRiskLevel = "read" | "write" | "destructive"

type ToolExecutionContextBase = {
  auth: RequestAuthContext
  viewerAuth: ViewerAuthContext
  actor: string
  source: "agent" | "mcp"
  requestId?: string | null
}

export type ToolExecutionContext = ToolExecutionContextBase

export type RegisteredTool<TInput = any, TResult = any> = {
  name: string
  description: string
  inputSchema: ZodType<TInput>
  riskLevel: ToolRiskLevel
  internalOnly?: boolean
  execute: (ctx: ToolExecutionContext, input: TInput) => Promise<TResult>
}

export class ToolExecutionError extends Error {
  code: string
  meta?: Record<string, unknown>

  constructor(code: string, message?: string, meta?: Record<string, unknown>) {
    super(message ?? code)
    this.name = "ToolExecutionError"
    this.code = code
    this.meta = meta
  }
}
