-- CreateTable
CREATE TABLE "ChatInitialSend" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "claimedAt" DATETIME,
    "consumedAt" DATETIME,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChatInitialSend_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChatInitialSend_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatInitialSend_chatId_key" ON "ChatInitialSend"("chatId");

-- CreateIndex
CREATE INDEX "ChatInitialSend_userId_createdAt_idx" ON "ChatInitialSend"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatInitialSend_expiresAt_consumedAt_idx" ON "ChatInitialSend"("expiresAt", "consumedAt");
