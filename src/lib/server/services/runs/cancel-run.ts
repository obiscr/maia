import "server-only"

import { ensureEngineRunning } from "@/lib/server/maia/server"
import { prisma } from "@/lib/server/db"
import { getRunFindFirstWhereByPublicId } from "@/lib/server/scopes/runs-scope"
import type { ViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export async function cancelRunByPublicId(params: {
  viewerAuth: ViewerAuthContext
  runId: string
  reason?: string | null
}) {
  const runPublicId = String(params.runId || "")
    .trim()
    .toLowerCase()
  const run = await prisma.run.findFirst({
    where: getRunFindFirstWhereByPublicId(params.viewerAuth, runPublicId),
    select: { id: true },
  })
  if (!run) return { ok: false as const, code: "RUN_NOT_FOUND" as const }

  const eng = await ensureEngineRunning()
  await eng.requestCancelRun({ runId: run.id, reason: params.reason ?? null })
  void eng.tick()
  return { ok: true as const, runPublicId }
}
