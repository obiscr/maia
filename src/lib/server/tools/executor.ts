import "server-only"

import { beginOperation, requestHashFor, storeOperationResponse } from "@/lib/server/operations/operations"
import type { ToolExecutionContext } from "@/lib/server/tools/types"
import { ToolExecutionError } from "@/lib/server/tools/types"
import { getRegisteredTool } from "@/lib/server/tools/registry"
import { TOOL_OPERATION_BINDINGS, operationSourceFromToolContext } from "@/lib/server/tools/operation-bindings"
import { isPlainObject } from "@/lib/shared/lang/is-plain-object"

export async function executeRegisteredTool(params: { name: string; input: unknown; ctx: ToolExecutionContext }) {
  const tool = getRegisteredTool(params.name)
  if (!tool) throw new ToolExecutionError("TOOL_NOT_FOUND", `Unknown tool: ${params.name}`, { tool: params.name })
  const parsed = tool.inputSchema.safeParse(params.input)
  if (!parsed.success) {
    throw new ToolExecutionError("INVALID_TOOL_INPUT", "Invalid tool input", {
      tool: tool.name,
      issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    })
  }
  return await tool.execute(params.ctx, parsed.data)
}

export async function executeRegisteredToolWithOperation(params: {
  name: string
  input: unknown
  ctx: ToolExecutionContext
}) {
  const binding = TOOL_OPERATION_BINDINGS[params.name]
  const source = operationSourceFromToolContext(params.ctx.source)
  if (!binding || !source) return await executeRegisteredTool(params)

  const started = await beginOperation({
    action: binding.action,
    source,
    scope: binding.scope,
    targetType: binding.targetType,
    targetId: binding.targetId(params.input) ?? undefined,
    requestHash: requestHashFor({
      method: "TOOL",
      path: `tool:${params.name}`,
      bodyText: (() => {
        try {
          return JSON.stringify(params.input ?? null)
        } catch {
          return "[unserializable]"
        }
      })(),
    }),
    idempotencyKey: null,
    actor: params.ctx.actor ?? null,
    tenantId: null,
    requestId: params.ctx.requestId ?? null,
  })
  const operationInternalId = started.operation.id
  const operationPublicId = String(started.operation.publicId ?? operationInternalId)

  try {
    const result = await executeRegisteredTool(params)
    await storeOperationResponse({
      operationId: operationInternalId,
      reply: {
        status: 200,
        body: isPlainObject(result)
          ? { ...(result as Record<string, unknown>), operationId: operationPublicId }
          : { data: result, operationId: operationPublicId },
      },
    })
    return result
  } catch (e) {
    await storeOperationResponse({
      operationId: operationInternalId,
      reply: {
        status: e instanceof ToolExecutionError ? 400 : 500,
        body: {
          code: e instanceof ToolExecutionError ? e.code : "INTERNAL_SERVER_ERROR",
          ...(e instanceof ToolExecutionError && e.meta ? { meta: e.meta } : {}),
          operationId: operationPublicId,
        },
      },
      error: e,
    })
    throw e
  }
}
