import "server-only"

import crypto from "crypto"

import { AttemptStatus, LogLevel, LogSource, StepStatus } from "@prisma/client"
import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import { emitLogLineWithMeta, emitStepStatus } from "@/lib/server/maia/logging"

export async function claimAndStartAttempt(params: {
  runId: string
  stepKey: string
  workerId: string
  attemptLeaseMs: number
  executeAttempt: (args: { runId: string; stepKey: string; attemptNo: number }) => void
}) {
  const { runId, stepKey } = params
  const now = new Date()
  const claimed = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const updated = await tx.runStep.updateMany({
      where: { runId, stepKey, status: StepStatus.PENDING },
      data: { status: StepStatus.RUNNING, startedAt: now, finishedAt: null },
    })
    if (updated.count !== 1) return null

    const rs = await tx.runStep.findUnique({
      where: { runId_stepKey: { runId, stepKey } },
      select: { timeoutMs: true },
    })
    const timeoutMs = Number(rs?.timeoutMs ?? 0)
    const deadlineAt = Number.isFinite(timeoutMs) && timeoutMs > 0 ? new Date(now.getTime() + timeoutMs) : null

    const agg = await tx.attempt.aggregate({ where: { runId, stepKey }, _max: { attemptNo: true } })
    const attemptNo = (agg._max.attemptNo ?? 0) + 1

    const attempt = await tx.attempt.create({
      data: {
        id: crypto.randomUUID(),
        runId,
        stepKey,
        attemptNo,
        status: AttemptStatus.RUNNING,
        workerId: params.workerId,
        leaseExpiresAt: new Date(now.getTime() + params.attemptLeaseMs),
        heartbeatAt: now,
        deadlineAt,
        startedAt: now,
      },
    })
    return attempt
  })

  if (!claimed) return false

  await emitStepStatus(runId, stepKey, StepStatus.RUNNING, claimed.attemptNo)
  // Ensure every step has at least one visible log line even if the user script prints nothing.
  await emitLogLineWithMeta({
    runId,
    stepKey,
    attemptNo: claimed.attemptNo,
    stream: "stdout",
    line: "Step started",
    level: LogLevel.INFO,
    source: LogSource.SYSTEM,
    kind: "status",
  })
  params.executeAttempt({ runId, stepKey, attemptNo: claimed.attemptNo })
  return true
}
