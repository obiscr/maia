import { z } from "zod"

import { fail, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { requireRequestAuth } from "@/lib/server/authz"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { mcpCallTool } from "@/lib/server/mcp/adapter"
import { ToolExecutionError } from "@/lib/server/tools/types"
import { zodIssues } from "@/lib/shared/http/zod"

export const runtime = "nodejs"

const bodySchema = z.object({
  name: z.string().trim().min(1),
  arguments: z.unknown().optional(),
})

function mapToolErrorStatus(code: string) {
  if (code === "UNAUTHORIZED") return 401
  if (code === "FORBIDDEN" || code === "INSUFFICIENT_SCOPE") return 403
  if (code === "TOOL_NOT_FOUND" || code.endsWith("_NOT_FOUND") || code === "NOT_FOUND") return 404
  if (code.includes("CONFLICT")) return 409
  if (code === "INVALID_TOOL_INPUT") return 422
  return 400
}

export const POST = withApiObservability(async (req: Request) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)

  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(await req.json().catch(() => ({})))
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    return fail({ status: 400, code: "INVALID_BODY" })
  }

  try {
    const result = await mcpCallTool({
      name: body.name,
      arguments: body.arguments ?? {},
      ctx: {
        auth,
        viewerAuth,
        actor: `user:${auth.publicId}`,
        source: "mcp",
        requestId: req.headers.get("x-request-id"),
      },
    })
    return ok(result)
  } catch (e) {
    if (e instanceof ToolExecutionError) {
      return fail({ status: mapToolErrorStatus(e.code), code: e.code, meta: e.meta })
    }
    throw e
  }
})
