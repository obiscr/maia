import { prisma } from "@/lib/server/db"
import { fail, notFound, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { requireRequestAuth } from "@/lib/server/authz"
import { getRunFindFirstWhereByPublicId } from "@/lib/server/scopes/runs-scope"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export const runtime = "nodejs"

export const GET = withApiObservability(async (req: Request, ctx: { params: Promise<{ runId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { runId } = await ctx.params
  const runPublicId = String(runId || "")
    .trim()
    .toLowerCase()
  const url = new URL(req.url)
  const stepKey = (url.searchParams.get("stepKey") ?? "").trim() || null

  const run = await prisma.run.findFirst({
    where: getRunFindFirstWhereByPublicId(viewerAuth, runPublicId),
    select: { id: true },
  })
  if (!run) return notFound("RUN_NOT_FOUND")
  if (!stepKey) return fail({ status: 422, code: "STEP_KEY_REQUIRED" })

  const attempts = await prisma.attempt.findMany({
    where: { runId: run.id, stepKey },
    orderBy: [{ attemptNo: "asc" }],
    select: {
      stepKey: true,
      attemptNo: true,
      status: true,
      exitCode: true,
      errorCode: true,
      errorMessage: true,
      errorMetaJson: true,
      errorAt: true,
      startedAt: true,
      finishedAt: true,
    },
  })

  return ok({ attempts })
})
