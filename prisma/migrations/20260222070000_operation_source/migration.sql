-- Add operation source channel for origin tracing (ui|agent|mcp).
ALTER TABLE "Operation"
ADD COLUMN "source" TEXT;
