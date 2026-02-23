-- Add the new agentMode column
ALTER TABLE "Chat" ADD COLUMN "agentMode" TEXT;

-- Migrate existing data from profileId to agentMode
UPDATE "Chat" SET "agentMode" = "profileId" WHERE "profileId" IS NOT NULL;
