import "server-only"

import { zodToJsonSchema } from "zod-to-json-schema"

import type { ToolExecutionContext } from "@/lib/server/tools/types"
import { listRegisteredTools } from "@/lib/server/tools/registry"
import { executeRegisteredToolWithOperation } from "@/lib/server/tools/executor"

function schemaForMcpTool(name: string, inputSchema: unknown): Record<string, unknown> | null {
  try {
    const out = zodToJsonSchema(inputSchema as any, {
      name: `${name}Input`,
      target: "jsonSchema7",
      $refStrategy: "none",
    })
    if (out && typeof out === "object" && !Array.isArray(out)) {
      return out as Record<string, unknown>
    }
  } catch (error) {
    console.error("[mcp] failed to convert tool schema", { tool: name, error })
  }
  return null
}

export function mcpListTools() {
  return listRegisteredTools()
    .map((t) => {
      const inputSchema = schemaForMcpTool(t.name, t.inputSchema)
      if (!inputSchema) return null
      return {
        name: t.name,
        description: t.description,
        riskLevel: t.riskLevel,
        inputSchema,
      }
    })
    .filter((t): t is NonNullable<typeof t> => t !== null)
}

export async function mcpCallTool(params: { name: string; arguments: unknown; ctx: ToolExecutionContext }) {
  const result = await executeRegisteredToolWithOperation({
    name: params.name,
    input: params.arguments,
    ctx: params.ctx,
  })
  return { content: [{ type: "json", json: result }] }
}
