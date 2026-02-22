/*
  BREAKING CHANGE:
  - You are about to drop the `AgentRun` table. If the table is not empty, all the data it contains will be lost.
*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "AgentRun";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "Chat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "publicNumber" INTEGER NOT NULL DEFAULT 0,
    "publicId" TEXT NOT NULL DEFAULT '',
    "userId" TEXT NOT NULL,
    "workflowId" TEXT,
    "title" TEXT NOT NULL DEFAULT '',
    "model" TEXT,
    "profileId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Chat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Chat_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow" ("publicId") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "parts" TEXT NOT NULL DEFAULT '[]',
    "attachments" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Chat_publicId_key" ON "Chat"("publicId");

-- CreateIndex
CREATE INDEX "Chat_userId_updatedAt_idx" ON "Chat"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "Chat_workflowId_idx" ON "Chat"("workflowId");

-- CreateIndex
CREATE INDEX "Message_chatId_createdAt_idx" ON "Message"("chatId", "createdAt");
