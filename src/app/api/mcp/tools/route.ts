import { ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { requireRequestAuth } from "@/lib/server/authz"
import { mcpListTools } from "@/lib/server/mcp/adapter"

export const runtime = "nodejs"

export const GET = withApiObservability(async () => {
  requireRequestAuth()
  return ok({ tools: mcpListTools() })
})
