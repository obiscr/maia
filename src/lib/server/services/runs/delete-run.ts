import "server-only"

import fs from "node:fs/promises"

import { prisma } from "@/lib/server/db"
import { ensureEngineRunning } from "@/lib/server/maia/server"
import { runDir } from "@/lib/server/maia/paths"
import { getRunFindFirstWhereByPublicId } from "@/lib/server/scopes/runs-scope"
import type { ViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export async function deleteRunByPublicId(params: { viewerAuth: ViewerAuthContext; runId: string }) {
  const runPublicId = String(params.runId || "")
    .trim()
    .toLowerCase()
  await ensureEngineRunning()

  const run = await prisma.run.findFirst({
    where: getRunFindFirstWhereByPublicId(params.viewerAuth, runPublicId),
    select: { id: true, status: true },
  })
  if (!run) return { ok: false as const, code: "RUN_NOT_FOUND" as const }
  if (run.status === "RUNNING") return { ok: false as const, code: "RUN_IS_RUNNING" as const }

  await prisma.run.delete({ where: { id: run.id } })
  try {
    await fs.rm(runDir(run.id), { recursive: true, force: true })
  } catch {}
  return { ok: true as const }
}
