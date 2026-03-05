import "server-only"

import { createMcpHandler } from "mcp-handler"

import { requireRequestAuth } from "@/lib/server/authz"
import { withApiObservability, getRequestStore } from "@/lib/server/observability"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { executeRegisteredToolWithOperation } from "@/lib/server/tools/executor"
import { listRegisteredTools } from "@/lib/server/tools/registry"
import { ToolExecutionError } from "@/lib/server/tools/types"

export const runtime = "nodejs"

const mcpHandler = createMcpHandler(
  (server) => {
    for (const tool of listRegisteredTools()) {
      server.registerTool(
        tool.name,
        {
          title: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: {
            title: tool.name,
            ...(tool.riskLevel === "read" ? { readOnlyHint: true, idempotentHint: true } : {}),
            ...(tool.riskLevel === "destructive" ? { destructiveHint: true } : {}),
          },
          _meta: { riskLevel: tool.riskLevel },
        },
        async (args) => {
          const auth = requireRequestAuth()
          const viewerAuth = toViewerAuthContext(auth)
          const requestId = getRequestStore()?.id ?? null

          try {
            const result = await executeRegisteredToolWithOperation({
              name: tool.name,
              input: args ?? {},
              ctx: {
                auth,
                viewerAuth,
                actor: `user:${auth.publicId}`,
                source: "mcp",
                requestId,
              },
            })

            return {
              content: [{ type: "text", text: JSON.stringify(result) }],
              structuredContent: result,
            }
          } catch (e) {
            if (e instanceof ToolExecutionError) {
              const errorBody = {
                ok: false as const,
                code: e.code,
                ...(e.meta ? { meta: e.meta } : {}),
                requestId,
              }
              return {
                isError: true,
                content: [{ type: "text", text: JSON.stringify(errorBody) }],
                structuredContent: errorBody,
              }
            }
            throw e
          }
        },
      )
    }
  },
  {
    serverInfo: { name: "maia", version: "0.1.0" },
  },
  {
    basePath: "/api",
    disableSse: true,
    verboseLogs: process.env.NODE_ENV !== "production",
  },
)

export const GET = withApiObservability(async (req: Request) => {
  return await mcpHandler(req)
})

export const POST = withApiObservability(async (req: Request) => {
  return await mcpHandler(req)
})

