-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RunStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "depsJson" TEXT NOT NULL,
    "scriptEsm" TEXT NOT NULL,
    "timeoutMs" INTEGER NOT NULL DEFAULT 600000,
    "retryPolicyJson" TEXT NOT NULL DEFAULT '{}',
    "nextAttemptAt" DATETIME,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RunStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_RunStep" ("createdAt", "depsJson", "finishedAt", "id", "name", "runId", "scriptEsm", "startedAt", "status", "stepKey", "timeoutMs", "updatedAt") SELECT "createdAt", "depsJson", "finishedAt", "id", "name", "runId", "scriptEsm", "startedAt", "status", "stepKey", "timeoutMs", "updatedAt" FROM "RunStep";
DROP TABLE "RunStep";
ALTER TABLE "new_RunStep" RENAME TO "RunStep";
CREATE INDEX "RunStep_runId_status_idx" ON "RunStep"("runId", "status");
CREATE INDEX "RunStep_runId_status_nextAttemptAt_idx" ON "RunStep"("runId", "status", "nextAttemptAt");
CREATE UNIQUE INDEX "RunStep_runId_stepKey_key" ON "RunStep"("runId", "stepKey");
CREATE TABLE "new_WorkflowStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflowId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scriptEsm" TEXT NOT NULL,
    "timeoutMs" INTEGER NOT NULL DEFAULT 600000,
    "retryPolicyJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkflowStep_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_WorkflowStep" ("createdAt", "description", "id", "key", "name", "scriptEsm", "timeoutMs", "updatedAt", "workflowId") SELECT "createdAt", "description", "id", "key", "name", "scriptEsm", "timeoutMs", "updatedAt", "workflowId" FROM "WorkflowStep";
DROP TABLE "WorkflowStep";
ALTER TABLE "new_WorkflowStep" RENAME TO "WorkflowStep";
CREATE INDEX "WorkflowStep_workflowId_idx" ON "WorkflowStep"("workflowId");
CREATE UNIQUE INDEX "WorkflowStep_workflowId_key_key" ON "WorkflowStep"("workflowId", "key");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
