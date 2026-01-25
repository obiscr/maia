import { prisma } from "@/lib/server/db"
import { fail, notFound, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { workflowSnapshotSchema } from "@/lib/server/maia/snapshot"
import { WORKFLOW_EXPORT_FORMAT_V1 } from "@/lib/shared/workflow-import-export"

export const runtime = "nodejs"

function safeParseStringMap(raw: string | null | undefined): Record<string, string> {
  const txt = typeof raw === "string" ? raw : "{}"
  try {
    const obj = JSON.parse(txt)
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof v === "string") out[String(k)] = v
    }
    return out
  } catch {
    return {}
  }
}

function safeParseJsonValue(raw: string | null | undefined): unknown | null {
  if (typeof raw !== "string") return null
  const trimmed = raw.trim()
  if (!trimmed.length) return null
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return trimmed
  }
}

export const GET = withApiObservability(
  async (req: Request, ctx: { params: Promise<{ workflowId: string; version: string }> }) => {
    const { workflowId, version } = await ctx.params
    const url = new URL(req.url)
    const includeEnv = url.searchParams.get("includeEnv") === "1" || url.searchParams.get("includeEnv") === "true"

    const workflowPublicId = String(workflowId || "")
      .trim()
      .toLowerCase()
    const ver = Number(version)
    if (!Number.isInteger(ver) || ver <= 0) return fail({ status: 400, code: "INVALID_QUERY" })

    const wf = await prisma.workflow.findUnique({
      where: { publicId: workflowPublicId },
      select: { id: true, publicId: true, name: true, description: true },
    })
    if (!wf) return notFound("WORKFLOW_NOT_FOUND")

    const row = await prisma.workflowVersion.findFirst({
      where: { workflowId: wf.id, version: ver },
      select: { version: true, snapshotJson: true, createdAt: true, description: true },
    })
    if (!row) return notFound("WORKFLOW_VERSION_NOT_FOUND")

    let snapJson: unknown = null
    try {
      snapJson = JSON.parse(row.snapshotJson || "{}")
    } catch {
      return fail({ status: 500, code: "INVALID_WORKFLOW_SNAPSHOT" })
    }

    const parsed = workflowSnapshotSchema.safeParse(snapJson)
    if (!parsed.success) {
      return fail({ status: 500, code: "INVALID_WORKFLOW_SNAPSHOT" })
    }

    const snap = parsed.data

    const dependencies = safeParseStringMap(snap.dependencies)
    const env = includeEnv ? safeParseStringMap(snap.envJson) : {}
    const inputSpec = safeParseJsonValue(snap.inputSpec)
    const outputsSpec = safeParseJsonValue(snap.outputsSpec)

    return ok({
      format: WORKFLOW_EXPORT_FORMAT_V1,
      exportedAt: new Date().toISOString(),
      workflow: {
        id: wf.publicId,
        name: snap.workflowName || wf.name,
        description: wf.description ?? null,
      },
      version: {
        number: row.version,
        createdAt: row.createdAt ? row.createdAt.toISOString() : null,
        description: row.description ?? null,
      },
      flags: { envIncluded: includeEnv },
      data: {
        meta: {
          name: snap.workflowName || wf.name,
          description: wf.description ?? null,
          reservedInitialInputKeys: snap.reservedInitialInputKeys ?? undefined,
        },
        steps: snap.steps,
        env,
        dependencies,
        inputSpec,
        outputsSpec,
      },
    })
  },
)
