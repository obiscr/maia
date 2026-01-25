import path from "node:path"

import { prisma } from "@/lib/server/db"
import { ok } from "@/lib/server/http/response"
import { mark, withApiObservability } from "@/lib/server/observability"
import { readJsonFileOrNull } from "@/lib/server/maia/fs"
import { attemptDir } from "@/lib/server/maia/paths"
import { requireRequestAuth } from "@/lib/server/authz"
import { getRunFindFirstWhereByPublicId } from "@/lib/server/scopes/runs-scope"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export const runtime = "nodejs"

export const GET = withApiObservability(
  async (_: Request, ctx: { params: Promise<{ runId: string; stepKey: string }> }) => {
    const auth = requireRequestAuth()
    const viewerAuth = toViewerAuthContext(auth)
    const { runId, stepKey } = await ctx.params
    const runPublicId = String(runId || "")
      .trim()
      .toLowerCase()
    const run = await prisma.run.findFirst({
      where: getRunFindFirstWhereByPublicId(viewerAuth, runPublicId),
      select: { id: true },
    })
    if (!run) return ok({ available: false, code: "RUN_NOT_FOUND", attemptNo: null, input: null })
    const last = await prisma.attempt.findFirst({ where: { runId: run.id, stepKey }, orderBy: [{ attemptNo: "desc" }] })
    if (!last) return ok({ available: false, code: "NO_STEP_INPUT", attemptNo: null, input: null })
    const p = path.join(attemptDir(run.id, stepKey, last.attemptNo), "input.json")
    const json = await readJsonFileOrNull(p)
    if (!json) return ok({ available: false, code: "NO_STEP_INPUT", attemptNo: last.attemptNo, input: null })
    mark("fs.input")
    return ok({ available: true, code: null, attemptNo: last.attemptNo, input: json })
  },
)
