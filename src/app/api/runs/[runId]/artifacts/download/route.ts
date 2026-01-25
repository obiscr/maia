import "server-only"

import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"

import { prisma } from "@/lib/server/db"
import { fail, notFound } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { sanitizeFilename } from "@/lib/server/maia/job-files"
import { projectRoot, maiaDataDir } from "@/lib/server/maia/paths"
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
  const run = await prisma.run.findFirst({
    where: getRunFindFirstWhereByPublicId(viewerAuth, runPublicId),
    select: { id: true },
  })
  if (!run) return notFound("RUN_NOT_FOUND")
  const url = new URL(req.url)
  const artifactId = (url.searchParams.get("artifactInternalId") ?? url.searchParams.get("artifactId") ?? "").trim()
  if (!artifactId) return fail({ status: 422, code: "ARTIFACT_ID_REQUIRED" })

  const artifact = await prisma.artifact.findFirst({
    where: { id: artifactId, runId: run.id },
    select: { id: true, path: true },
  })
  if (!artifact) return notFound("ARTIFACT_NOT_FOUND")

  const relOrAbs = String(artifact.path ?? "")
    .trim()
    .replaceAll("\\", "/")
  if (!relOrAbs) return fail({ status: 400, code: "INVALID_PATH" })

  const root = path.resolve(projectRoot())
  const abs = path.isAbsolute(relOrAbs) ? path.resolve(relOrAbs) : path.resolve(path.join(root, relOrAbs))
  const dataBase = path.resolve(maiaDataDir())

  // Safety: only allow downloads from the instance data directory.
  if (!abs.startsWith(dataBase + path.sep)) return fail({ status: 400, code: "INVALID_PATH" })

  let st: { size: number; isFile: () => boolean }
  try {
    st = await fsp.stat(abs)
  } catch {
    return fail({ status: 404, code: "FILE_NOT_FOUND" })
  }
  if (!st.isFile()) return fail({ status: 404, code: "FILE_NOT_FOUND" })

  const nameParam = url.searchParams.get("name") ?? ""
  const filename = sanitizeFilename(nameParam || path.basename(abs) || "artifact")

  const nodeStream = fs.createReadStream(abs)
  const body = Readable.toWeb(nodeStream) as unknown as BodyInit

  return new Response(body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(st.size),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  })
})
