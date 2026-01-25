import { prisma } from "@/lib/server/db"
import { fail, notFound, ok } from "@/lib/server/http/response"
import { mark, withApiObservability } from "@/lib/server/observability"
import { workflowSnapshotSchema, type WorkflowSnapshot } from "@/lib/server/maia/snapshot"

export const runtime = "nodejs"

export const GET = withApiObservability(
  async (_: Request, ctx: { params: Promise<{ workflowId: string; version: string }> }) => {
    const { workflowId, version } = await ctx.params
    const workflowPublicId = String(workflowId || "")
      .trim()
      .toLowerCase()
    const ver = Number(version)
    if (!Number.isInteger(ver) || ver <= 0) return fail({ status: 400, code: "INVALID_QUERY" })

    const wf = await prisma.workflow.findUnique({
      where: { publicId: workflowPublicId },
      select: { id: true, publicId: true, name: true },
    })
    if (!wf) return notFound("WORKFLOW_NOT_FOUND")
    mark("db.workflow")

    const row = await prisma.workflowVersion.findFirst({
      where: { workflowId: wf.id, version: ver },
      select: { id: true, version: true, snapshotJson: true, description: true, createdAt: true },
    })
    if (!row) return notFound("WORKFLOW_VERSION_NOT_FOUND")
    mark("db.version")

    let snapshot: WorkflowSnapshot | null = null
    try {
      snapshot = workflowSnapshotSchema.parse(JSON.parse(row.snapshotJson || "{}"))
    } catch {
      snapshot = null
    }
    const reservedInitialInputKeys = snapshot?.reservedInitialInputKeys ?? null

    return ok({
      // Avoid leaking internal UUIDs.
      workflow: { id: wf.publicId, publicId: wf.publicId, name: wf.name },
      version: {
        // UI key only; avoid leaking internal workflowVersion.id
        id: `${wf.publicId}:v${row.version}`,
        version: row.version,
        createdAt: row.createdAt,
        description: row.description ?? null,
        snapshot,
        snapshotJson: row.snapshotJson,
        reservedInitialInputKeys,
      },
    })
  },
)
