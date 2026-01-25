import "server-only"

import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"

import { NextResponse } from "next/server"

import { prisma } from "@/lib/server/db"
import { fail, notFound } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { sanitizeFilename } from "@/lib/server/maia/job-files"
import { runDir } from "@/lib/server/maia/paths"
import { requireRequestAuth } from "@/lib/server/authz"
import { getRunFindFirstWhereByPublicId } from "@/lib/server/scopes/runs-scope"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export const runtime = "nodejs"

function normalizeRelPath(input: string) {
  const rel = (input || "").trim().replaceAll("\\", "/")
  if (!rel) return null
  if (rel.startsWith("/")) return null
  if (rel.includes("..")) return null
  if (!rel.startsWith("uploads/")) return null
  return rel
}

export const GET = withApiObservability(async (req: Request, ctx: { params: Promise<{ runId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { runId } = await ctx.params
  const runPublicId = String(runId || "")
    .trim()
    .toLowerCase()
  const url = new URL(req.url)
  const rel = normalizeRelPath(url.searchParams.get("path") ?? "")
  if (!rel) return fail({ status: 400, code: "INVALID_PATH" })

  const run = await prisma.run.findFirst({
    where: getRunFindFirstWhereByPublicId(viewerAuth, runPublicId),
    select: { id: true },
  })
  if (!run) return notFound("RUN_NOT_FOUND")

  const base = path.resolve(runDir(run.id))
  const abs = path.resolve(path.join(base, rel))
  if (!abs.startsWith(base + path.sep)) return fail({ status: 400, code: "INVALID_PATH" })

  let st: { size: number; isFile: () => boolean }
  try {
    st = await fsp.stat(abs)
  } catch {
    return fail({ status: 404, code: "FILE_NOT_FOUND" })
  }
  if (!st.isFile()) return fail({ status: 404, code: "FILE_NOT_FOUND" })

  const nameParam = url.searchParams.get("name") ?? ""
  const filename = sanitizeFilename(nameParam || path.basename(rel) || "file")

  const nodeStream = fs.createReadStream(abs)
  const body = Readable.toWeb(nodeStream) as unknown as BodyInit

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(st.size),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  })
})
