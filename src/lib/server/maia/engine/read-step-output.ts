import "server-only"

import path from "path"

import { AttemptStatus } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import { ensureDir, pathExists, readJsonFile } from "@/lib/server/maia/fs"
import { attemptDir } from "@/lib/server/maia/paths"

/**
 * Read the most recent SUCCEEDED attempt output for a step.
 * Returns null when there is no successful attempt or output.json is missing.
 */
export async function readStepOutput(runId: string, stepKey: string) {
  const last = await prisma.attempt.findFirst({
    where: { runId, stepKey, status: AttemptStatus.SUCCEEDED },
    orderBy: [{ attemptNo: "desc" }],
  })
  if (!last) return null

  const outPath = path.join(attemptDir(runId, stepKey, last.attemptNo), "output.json")
  if (!(await pathExists(outPath))) return null

  // Defensive: ensure the attempt dir exists (older runs/tests might have been partially cleaned).
  await ensureDir(path.dirname(outPath)).catch(() => {})
  return await readJsonFile(outPath)
}
