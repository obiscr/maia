import "server-only"

import crypto from "crypto"
import fs from "fs/promises"
import path from "path"

import { prisma } from "@/lib/server/db"
import { sha256 } from "@/lib/server/maia/fs"
import { projectRoot } from "@/lib/server/maia/paths"

export async function recordArtifact(params: {
  runId: string
  stepKey: string
  attemptNo: number
  kind: string
  absPath: string
  summary?: string
}) {
  const { runId, stepKey, attemptNo, kind, absPath, summary } = params
  const st = await fs.stat(absPath)
  const buf = await fs.readFile(absPath)
  const rel = path.relative(projectRoot(), absPath)

  return await prisma.artifact.create({
    data: {
      id: crypto.randomUUID(),
      runId,
      stepKey,
      attemptNo,
      kind,
      path: rel.startsWith("..") ? absPath : rel,
      sizeBytes: st.size,
      sha256: sha256(buf),
      summary: summary ?? null,
    },
  })
}
