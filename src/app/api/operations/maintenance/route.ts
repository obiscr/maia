import { ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { getCleanupConfig, getLastCleanupResult, maybeCleanupOperations } from "@/lib/server/operations/cleanup"

export const runtime = "nodejs"

export const GET = withApiObservability(async (req: Request) => {
  const url = new URL(req.url)
  const run = url.searchParams.get("run") === "1" || url.searchParams.get("run") === "true"
  if (run) {
    // Run on-demand (still best-effort; this endpoint is intended for ops/debug only).
    await maybeCleanupOperations()
  }

  return ok({
    ok: true,
    config: getCleanupConfig(),
    last: getLastCleanupResult(),
  })
})
