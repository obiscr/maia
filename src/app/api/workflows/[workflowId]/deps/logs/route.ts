import { z } from "zod"

import { LogSource } from "@prisma/client"
import { prisma } from "@/lib/server/db"
import { fail, notFound, ok } from "@/lib/server/http/response"
import { zodIssues } from "@/lib/shared/http/zod"
import { withApiObservability } from "@/lib/server/observability"

export const runtime = "nodejs"

const querySchema = z.object({
  take: z.coerce.number().int().min(1).max(500).default(200),
  /**
   * By default, return only the most recent install attempt.
   * Use `mode=all` to return the full history (up to `take`).
   */
  mode: z.enum(["latest", "all"]).default("latest"),
})

export const GET = withApiObservability(async (req: Request, ctx: { params: Promise<{ workflowId: string }> }) => {
  const { workflowId } = await ctx.params
  const workflowPublicId = String(workflowId || "")
    .trim()
    .toLowerCase()

  const wf = await prisma.workflow.findUnique({ where: { publicId: workflowPublicId } })
  if (!wf) return notFound("WORKFLOW_NOT_FOUND")

  const url = new URL(req.url)
  let qp: z.infer<typeof querySchema>
  try {
    qp = querySchema.parse({
      take: url.searchParams.get("take") ?? undefined,
      mode: url.searchParams.get("mode") ?? undefined,
    })
  } catch (e) {
    if (e instanceof z.ZodError) {
      return fail({ status: 422, code: "INVALID_QUERY", issues: zodIssues(e) })
    }
    throw e
  }

  const prefix = `[workflow:${wf.id}] `
  const rows = await prisma.logEvent.findMany({
    where: {
      runId: null,
      source: LogSource.INSTALL,
      message: { startsWith: prefix },
    },
    orderBy: [{ id: "desc" }],
    take: qp.take,
    select: { id: true, level: true, source: true, message: true, createdAt: true },
  })

  // Return chronological order for display.
  const logs = rows
    .slice()
    .reverse()
    .map((r) => ({
      id: `log:${String(r.id)}`,
      level: r.level,
      createdAt: r.createdAt,
      message: r.message.startsWith(prefix) ? r.message.slice(prefix.length) : r.message,
    }))

  if (qp.mode === "all") return ok({ logs })

  // Default behavior: only show the most recent install attempt.
  // We detect attempts by scanning for the last "pnpm install (prod) starting" marker.
  const startNeedle = "pnpm install (prod) starting"
  let lastStartIdx = -1
  for (let i = logs.length - 1; i >= 0; i--) {
    const msg = String(logs[i]?.message ?? "")
    if (msg.includes(startNeedle)) {
      lastStartIdx = i
      break
    }
  }
  const sliced = lastStartIdx >= 0 ? logs.slice(lastStartIdx) : logs
  return ok({ logs: sliced })
})
