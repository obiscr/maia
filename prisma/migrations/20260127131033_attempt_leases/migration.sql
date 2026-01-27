-- AlterTable
ALTER TABLE "Attempt" ADD COLUMN "deadlineAt" DATETIME;
ALTER TABLE "Attempt" ADD COLUMN "heartbeatAt" DATETIME;
ALTER TABLE "Attempt" ADD COLUMN "leaseExpiresAt" DATETIME;
ALTER TABLE "Attempt" ADD COLUMN "workerId" TEXT;

-- CreateIndex
CREATE INDEX "Attempt_status_leaseExpiresAt_idx" ON "Attempt"("status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "Attempt_status_deadlineAt_idx" ON "Attempt"("status", "deadlineAt");
