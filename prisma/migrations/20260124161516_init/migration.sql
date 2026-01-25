-- CreateTable
CREATE TABLE "Installation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "installedAt" DATETIME,
    "instanceId" TEXT NOT NULL,
    "registrationMode" TEXT NOT NULL DEFAULT 'DISABLED',
    "encryptionKeyFingerprint" TEXT,
    "smtpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT false,
    "smtpUsername" TEXT,
    "smtpFromEmail" TEXT,
    "smtpFromName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SystemSecret" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "ivBase64" TEXT NOT NULL,
    "ciphertextBase64" TEXT NOT NULL,
    "authTagBase64" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastUsedAt" DATETIME
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "publicId" TEXT NOT NULL,
    "publicNumber" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "isDisabled" BOOLEAN NOT NULL DEFAULT false,
    "passwordHash" TEXT NOT NULL,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "totpSecret" TEXT,
    "totpVerifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "UserSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "valueJson" TEXT NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserSecret" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "ivBase64" TEXT NOT NULL,
    "ciphertextBase64" TEXT NOT NULL,
    "authTagBase64" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastUsedAt" DATETIME,
    CONSTRAINT "UserSecret_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "ip" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuthChallenge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "ip" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "AuthChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "ip" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Workflow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "publicId" TEXT NOT NULL,
    "publicNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerUserId" TEXT,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "triggeredByUserId" TEXT,
    "dependencies" TEXT NOT NULL,
    "envJson" TEXT NOT NULL DEFAULT '{}',
    "inputSpec" TEXT,
    "outputsSpec" TEXT,
    "depsHash" TEXT NOT NULL,
    "depsStatus" TEXT NOT NULL DEFAULT 'IDLE',
    "depsErrorCode" TEXT,
    "depsErrorMessage" TEXT,
    "depsErrorMetaJson" TEXT,
    "depsErrorAt" DATETIME,
    "depsUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Workflow_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Workflow_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Workflow_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Workflow_triggeredByUserId_fkey" FOREIGN KEY ("triggeredByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkflowVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflowId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshotJson" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerUserId" TEXT,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "triggeredByUserId" TEXT,
    CONSTRAINT "WorkflowVersion_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WorkflowVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WorkflowVersion_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WorkflowVersion_triggeredByUserId_fkey" FOREIGN KEY ("triggeredByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WorkflowVersion_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkflowStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflowId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scriptEsm" TEXT NOT NULL,
    "timeoutMs" INTEGER NOT NULL DEFAULT 600000,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkflowStep_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkflowStepDep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflowId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "dependsOnStepId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkflowStepDep_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "publicId" TEXT NOT NULL,
    "publicNumber" INTEGER NOT NULL,
    "workflowId" TEXT NOT NULL,
    "workflowVersionId" TEXT,
    "workflowVersionNumber" INTEGER,
    "workflowName" TEXT NOT NULL,
    "workflowSnap" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "cancelRequestedAt" DATETIME,
    "cancelRequestedReason" TEXT,
    "forkedFromRunId" TEXT,
    "forkKind" TEXT,
    "forkStepKey" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "failureMetaJson" TEXT,
    "failureAt" DATETIME,
    "initialInput" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "triggeredByUserId" TEXT,
    "triggerKind" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Run_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Run_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Run_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Run_triggeredByUserId_fkey" FOREIGN KEY ("triggeredByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Run_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Run_workflowVersionId_fkey" FOREIGN KEY ("workflowVersionId") REFERENCES "WorkflowVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RunStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "depsJson" TEXT NOT NULL,
    "scriptEsm" TEXT NOT NULL,
    "timeoutMs" INTEGER NOT NULL DEFAULT 600000,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RunStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Attempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "exitCode" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "errorMetaJson" TEXT,
    "errorAt" DATETIME,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Attempt_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attempt_runId_stepKey_fkey" FOREIGN KEY ("runId", "stepKey") REFERENCES "RunStep" ("runId", "stepKey") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "sha256" TEXT,
    "summary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Artifact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Artifact_runId_stepKey_attemptNo_fkey" FOREIGN KEY ("runId", "stepKey", "attemptNo") REFERENCES "Attempt" ("runId", "stepKey", "attemptNo") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LogEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "runId" TEXT,
    "stepKey" TEXT,
    "attemptNo" INTEGER,
    "level" TEXT NOT NULL DEFAULT 'INFO',
    "source" TEXT NOT NULL DEFAULT 'SYSTEM',
    "message" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LogEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "publicId" TEXT NOT NULL,
    "publicNumber" INTEGER NOT NULL,
    "name" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "workflowId" TEXT NOT NULL,
    "pinnedWorkflowVersionId" TEXT,
    "kind" TEXT NOT NULL,
    "cron" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "intervalMs" INTEGER,
    "misfirePolicy" TEXT NOT NULL DEFAULT 'FIRE_ONCE',
    "catchUpLimit" INTEGER,
    "overlapPolicy" TEXT NOT NULL DEFAULT 'SKIP',
    "inputJson" TEXT NOT NULL DEFAULT '{}',
    "urlFilesJson" TEXT NOT NULL DEFAULT '[]',
    "nextRunAt" DATETIME,
    "lastRunAt" DATETIME,
    "lastFireAt" DATETIME,
    "lastFireJobRunId" TEXT,
    "lastFireErrorCode" TEXT,
    "lastFireErrorMetaJson" TEXT,
    "ownerUserId" TEXT,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "triggeredByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Schedule_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Schedule_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Schedule_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Schedule_triggeredByUserId_fkey" FOREIGN KEY ("triggeredByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Schedule_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Schedule_pinnedWorkflowVersionId_fkey" FOREIGN KEY ("pinnedWorkflowVersionId") REFERENCES "WorkflowVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "publicId" TEXT NOT NULL,
    "publicNumber" INTEGER NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "workflowId" TEXT NOT NULL,
    "pinnedWorkflowVersionId" TEXT,
    "concurrencyLimit" INTEGER,
    "rampUpSeconds" INTEGER,
    "autoMaxConcurrency" INTEGER,
    "failFast" BOOLEAN NOT NULL DEFAULT false,
    "maxFailures" INTEGER,
    "sourceJson" TEXT NOT NULL DEFAULT '{}',
    "urlFilesJson" TEXT NOT NULL DEFAULT '[]',
    "fanoutSeedJson" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "failureMetaJson" TEXT,
    "failureAt" DATETIME,
    "ownerUserId" TEXT,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "triggeredByUserId" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Batch_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Batch_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Batch_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Batch_triggeredByUserId_fkey" FOREIGN KEY ("triggeredByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Batch_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Batch_pinnedWorkflowVersionId_fkey" FOREIGN KEY ("pinnedWorkflowVersionId") REFERENCES "WorkflowVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "publicId" TEXT NOT NULL,
    "publicNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "cancelRequestedAt" DATETIME,
    "cancelRequestedReason" TEXT,
    "workflowId" TEXT NOT NULL,
    "pinnedWorkflowVersionId" TEXT,
    "scheduleId" TEXT,
    "batchId" TEXT,
    "scheduledFor" DATETIME,
    "inputJson" TEXT NOT NULL DEFAULT '{}',
    "ownerUserId" TEXT,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "triggeredByUserId" TEXT,
    "requestedByUserId" TEXT,
    "claimedBy" TEXT,
    "claimedAt" DATETIME,
    "leaseExpiresAt" DATETIME,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "nextAttemptAt" DATETIME,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "lastErrorMetaJson" TEXT,
    "lastErrorAt" DATETIME,
    "runId" TEXT,
    "queuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "JobRun_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JobRun_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JobRun_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JobRun_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JobRun_triggeredByUserId_fkey" FOREIGN KEY ("triggeredByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JobRun_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JobRun_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "JobRun_pinnedWorkflowVersionId_fkey" FOREIGN KEY ("pinnedWorkflowVersionId") REFERENCES "WorkflowVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "JobRun_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "JobRun_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobRunAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobRunId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "runId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "errorMetaJson" TEXT,
    "errorAt" DATETIME,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "JobRunAttempt_jobRunId_fkey" FOREIGN KEY ("jobRunId") REFERENCES "JobRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JobRunAttempt_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InputBlob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "mime" TEXT,
    "storagePath" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "InputFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobRunId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "name" TEXT NOT NULL,
    "url" TEXT,
    "error" TEXT,
    "blobId" TEXT,
    "sha256" TEXT,
    "sizeBytes" INTEGER,
    "mime" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InputFile_jobRunId_fkey" FOREIGN KEY ("jobRunId") REFERENCES "JobRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InputFile_blobId_fkey" FOREIGN KEY ("blobId") REFERENCES "InputBlob" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StreamEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "topic" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "dataJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "publicId" TEXT NOT NULL,
    "publicNumber" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "workflowId" TEXT,
    "ownerUserId" TEXT,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "triggeredByUserId" TEXT,
    "operationId" TEXT,
    "inputJson" TEXT NOT NULL DEFAULT '{}',
    "snapshotJson" TEXT NOT NULL DEFAULT '{}',
    "lastEventId" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "errorMetaJson" TEXT,
    "errorAt" DATETIME,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentRun_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow" ("publicId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AgentRun_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AgentRun_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AgentRun_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AgentRun_triggeredByUserId_fkey" FOREIGN KEY ("triggeredByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AgentRun_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Operation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "publicId" TEXT NOT NULL,
    "publicNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "action" TEXT NOT NULL,
    "scope" TEXT,
    "targetType" TEXT,
    "targetId" TEXT,
    "actor" TEXT,
    "tenantId" TEXT,
    "requestId" TEXT,
    "progressCurrent" INTEGER NOT NULL DEFAULT 0,
    "progressTotal" INTEGER,
    "progressMessageKey" TEXT,
    "progressMessageParamsJson" TEXT,
    "idempotencyKey" TEXT,
    "requestHash" TEXT,
    "responseStatus" INTEGER,
    "responseJson" TEXT,
    "responseHeadersJson" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "errorJson" TEXT,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "IdempotencyRecord_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PublicIdCounter" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "nextNumber" INTEGER NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Installation_instanceId_key" ON "Installation"("instanceId");

-- CreateIndex
CREATE UNIQUE INDEX "SystemSecret_key_key" ON "SystemSecret"("key");

-- CreateIndex
CREATE INDEX "SystemSecret_updatedAt_idx" ON "SystemSecret"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_publicId_key" ON "User"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_updatedAt_idx" ON "User"("updatedAt");

-- CreateIndex
CREATE INDEX "UserSetting_userId_updatedAt_idx" ON "UserSetting"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserSetting_userId_key_key" ON "UserSetting"("userId", "key");

-- CreateIndex
CREATE INDEX "UserSecret_userId_updatedAt_idx" ON "UserSecret"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserSecret_userId_key_key" ON "UserSecret"("userId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthChallenge_tokenHash_key" ON "AuthChallenge"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthChallenge_userId_expiresAt_idx" ON "AuthChallenge"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "AuthChallenge_expiresAt_idx" ON "AuthChallenge"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_expiresAt_idx" ON "PasswordResetToken"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Workflow_publicId_key" ON "Workflow"("publicId");

-- CreateIndex
CREATE INDEX "Workflow_updatedAt_idx" ON "Workflow"("updatedAt");

-- CreateIndex
CREATE INDEX "Workflow_ownerUserId_updatedAt_idx" ON "Workflow"("ownerUserId", "updatedAt");

-- CreateIndex
CREATE INDEX "Workflow_triggeredByUserId_updatedAt_idx" ON "Workflow"("triggeredByUserId", "updatedAt");

-- CreateIndex
CREATE INDEX "WorkflowVersion_workflowId_createdAt_idx" ON "WorkflowVersion"("workflowId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkflowVersion_ownerUserId_createdAt_idx" ON "WorkflowVersion"("ownerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkflowVersion_createdByUserId_createdAt_idx" ON "WorkflowVersion"("createdByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkflowVersion_updatedByUserId_createdAt_idx" ON "WorkflowVersion"("updatedByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkflowVersion_triggeredByUserId_createdAt_idx" ON "WorkflowVersion"("triggeredByUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowVersion_workflowId_version_key" ON "WorkflowVersion"("workflowId", "version");

-- CreateIndex
CREATE INDEX "WorkflowStep_workflowId_idx" ON "WorkflowStep"("workflowId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowStep_workflowId_key_key" ON "WorkflowStep"("workflowId", "key");

-- CreateIndex
CREATE INDEX "WorkflowStepDep_workflowId_stepId_idx" ON "WorkflowStepDep"("workflowId", "stepId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowStepDep_workflowId_stepId_dependsOnStepId_key" ON "WorkflowStepDep"("workflowId", "stepId", "dependsOnStepId");

-- CreateIndex
CREATE UNIQUE INDEX "Run_publicId_key" ON "Run"("publicId");

-- CreateIndex
CREATE INDEX "Run_workflowId_createdAt_idx" ON "Run"("workflowId", "createdAt");

-- CreateIndex
CREATE INDEX "Run_ownerUserId_createdAt_idx" ON "Run"("ownerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Run_createdByUserId_createdAt_idx" ON "Run"("createdByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Run_updatedByUserId_updatedAt_idx" ON "Run"("updatedByUserId", "updatedAt");

-- CreateIndex
CREATE INDEX "Run_triggeredByUserId_createdAt_idx" ON "Run"("triggeredByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Run_workflowVersionId_idx" ON "Run"("workflowVersionId");

-- CreateIndex
CREATE INDEX "Run_status_createdAt_idx" ON "Run"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Run_cancelRequestedAt_idx" ON "Run"("cancelRequestedAt");

-- CreateIndex
CREATE INDEX "Run_forkedFromRunId_idx" ON "Run"("forkedFromRunId");

-- CreateIndex
CREATE INDEX "RunStep_runId_status_idx" ON "RunStep"("runId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RunStep_runId_stepKey_key" ON "RunStep"("runId", "stepKey");

-- CreateIndex
CREATE INDEX "Attempt_runId_status_idx" ON "Attempt"("runId", "status");

-- CreateIndex
CREATE INDEX "Attempt_runId_stepKey_status_idx" ON "Attempt"("runId", "stepKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Attempt_runId_stepKey_attemptNo_key" ON "Attempt"("runId", "stepKey", "attemptNo");

-- CreateIndex
CREATE INDEX "Artifact_runId_stepKey_idx" ON "Artifact"("runId", "stepKey");

-- CreateIndex
CREATE INDEX "Artifact_runId_createdAt_idx" ON "Artifact"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "LogEvent_runId_id_idx" ON "LogEvent"("runId", "id");

-- CreateIndex
CREATE INDEX "LogEvent_createdAt_idx" ON "LogEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Schedule_publicId_key" ON "Schedule"("publicId");

-- CreateIndex
CREATE INDEX "Schedule_enabled_nextRunAt_idx" ON "Schedule"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "Schedule_workflowId_createdAt_idx" ON "Schedule"("workflowId", "createdAt");

-- CreateIndex
CREATE INDEX "Schedule_ownerUserId_createdAt_idx" ON "Schedule"("ownerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Schedule_createdByUserId_createdAt_idx" ON "Schedule"("createdByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Schedule_updatedByUserId_updatedAt_idx" ON "Schedule"("updatedByUserId", "updatedAt");

-- CreateIndex
CREATE INDEX "Schedule_triggeredByUserId_createdAt_idx" ON "Schedule"("triggeredByUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Batch_publicId_key" ON "Batch"("publicId");

-- CreateIndex
CREATE INDEX "Batch_status_createdAt_idx" ON "Batch"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Batch_workflowId_createdAt_idx" ON "Batch"("workflowId", "createdAt");

-- CreateIndex
CREATE INDEX "Batch_ownerUserId_createdAt_idx" ON "Batch"("ownerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Batch_createdByUserId_createdAt_idx" ON "Batch"("createdByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Batch_updatedByUserId_updatedAt_idx" ON "Batch"("updatedByUserId", "updatedAt");

-- CreateIndex
CREATE INDEX "Batch_triggeredByUserId_createdAt_idx" ON "Batch"("triggeredByUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobRun_publicId_key" ON "JobRun"("publicId");

-- CreateIndex
CREATE INDEX "JobRun_status_nextAttemptAt_idx" ON "JobRun"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "JobRun_workflowId_queuedAt_idx" ON "JobRun"("workflowId", "queuedAt");

-- CreateIndex
CREATE INDEX "JobRun_ownerUserId_queuedAt_idx" ON "JobRun"("ownerUserId", "queuedAt");

-- CreateIndex
CREATE INDEX "JobRun_createdByUserId_queuedAt_idx" ON "JobRun"("createdByUserId", "queuedAt");

-- CreateIndex
CREATE INDEX "JobRun_updatedByUserId_updatedAt_idx" ON "JobRun"("updatedByUserId", "updatedAt");

-- CreateIndex
CREATE INDEX "JobRun_triggeredByUserId_queuedAt_idx" ON "JobRun"("triggeredByUserId", "queuedAt");

-- CreateIndex
CREATE INDEX "JobRun_requestedByUserId_queuedAt_idx" ON "JobRun"("requestedByUserId", "queuedAt");

-- CreateIndex
CREATE INDEX "JobRun_scheduleId_queuedAt_idx" ON "JobRun"("scheduleId", "queuedAt");

-- CreateIndex
CREATE INDEX "JobRun_batchId_queuedAt_idx" ON "JobRun"("batchId", "queuedAt");

-- CreateIndex
CREATE INDEX "JobRun_cancelRequestedAt_idx" ON "JobRun"("cancelRequestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobRun_scheduleId_scheduledFor_key" ON "JobRun"("scheduleId", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "JobRun_runId_key" ON "JobRun"("runId");

-- CreateIndex
CREATE INDEX "JobRunAttempt_jobRunId_startedAt_idx" ON "JobRunAttempt"("jobRunId", "startedAt");

-- CreateIndex
CREATE INDEX "JobRunAttempt_runId_idx" ON "JobRunAttempt"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "JobRunAttempt_jobRunId_attemptNo_key" ON "JobRunAttempt"("jobRunId", "attemptNo");

-- CreateIndex
CREATE UNIQUE INDEX "InputBlob_sha256_key" ON "InputBlob"("sha256");

-- CreateIndex
CREATE INDEX "InputBlob_createdAt_idx" ON "InputBlob"("createdAt");

-- CreateIndex
CREATE INDEX "InputFile_jobRunId_createdAt_idx" ON "InputFile"("jobRunId", "createdAt");

-- CreateIndex
CREATE INDEX "InputFile_jobRunId_status_idx" ON "InputFile"("jobRunId", "status");

-- CreateIndex
CREATE INDEX "InputFile_sha256_idx" ON "InputFile"("sha256");

-- CreateIndex
CREATE INDEX "InputFile_source_status_idx" ON "InputFile"("source", "status");

-- CreateIndex
CREATE INDEX "StreamEvent_topic_id_idx" ON "StreamEvent"("topic", "id");

-- CreateIndex
CREATE INDEX "StreamEvent_createdAt_idx" ON "StreamEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_publicId_key" ON "AgentRun"("publicId");

-- CreateIndex
CREATE INDEX "AgentRun_status_createdAt_idx" ON "AgentRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_createdByUserId_createdAt_idx" ON "AgentRun"("createdByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_ownerUserId_createdAt_idx" ON "AgentRun"("ownerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_updatedByUserId_updatedAt_idx" ON "AgentRun"("updatedByUserId", "updatedAt");

-- CreateIndex
CREATE INDEX "AgentRun_triggeredByUserId_createdAt_idx" ON "AgentRun"("triggeredByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_workflowId_createdAt_idx" ON "AgentRun"("workflowId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_operationId_idx" ON "AgentRun"("operationId");

-- CreateIndex
CREATE UNIQUE INDEX "Operation_publicId_key" ON "Operation"("publicId");

-- CreateIndex
CREATE INDEX "Operation_status_createdAt_idx" ON "Operation"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Operation_targetType_targetId_idx" ON "Operation"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "Operation_requestId_idx" ON "Operation"("requestId");

-- CreateIndex
CREATE INDEX "Operation_tenantId_createdAt_idx" ON "Operation"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_operationId_idx" ON "IdempotencyRecord"("operationId");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_scope_key_key" ON "IdempotencyRecord"("scope", "key");
