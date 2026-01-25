import "server-only"

import type { Attempt } from "@prisma/client"
import { AttemptStatus } from "@prisma/client"

import { prisma } from "@/lib/server/db"

export async function bestEffortRunStepFailure(runId: string): Promise<{
  stepKey: string
  attemptNo: number
  exitCode: number | null
  stepErrorCode: string
  stepErrorMessage: string | null
  stepErrorMetaJson: string | null
} | null> {
  try {
    const at: Pick<
      Attempt,
      "stepKey" | "attemptNo" | "exitCode" | "errorCode" | "errorMessage" | "errorMetaJson"
    > | null = await prisma.attempt.findFirst({
      where: { runId, status: AttemptStatus.FAILED },
      orderBy: [{ finishedAt: "desc" }],
      select: {
        stepKey: true,
        attemptNo: true,
        exitCode: true,
        errorCode: true,
        errorMessage: true,
        errorMetaJson: true,
      },
    })
    if (!at) return null
    return {
      stepKey: String(at.stepKey),
      attemptNo: Number(at.attemptNo),
      exitCode: (at.exitCode ?? null) as number | null,
      stepErrorCode: String(at.errorCode ?? "UNKNOWN"),
      stepErrorMessage: at.errorMessage ? String(at.errorMessage) : null,
      stepErrorMetaJson: at.errorMetaJson ? String(at.errorMetaJson) : null,
    }
  } catch {
    return null
  }
}
