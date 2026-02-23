-- Migrate legacy profileId values to new agent mode names
UPDATE "Chat" SET "profileId" = 'agent' WHERE "profileId" = 'workflow.orchestrator';
UPDATE "Chat" SET "profileId" = 'chat'  WHERE "profileId" = 'general.tools';

-- Migrate legacy tool names in Message.parts JSON
-- Each old tool name is replaced with its new equivalent.
-- The tool names appear inside JSON as string values (e.g. "toolName":"set_plan"),
-- so we use exact quoted-string replacement to avoid false positives.

UPDATE "Message" SET "parts" = replace("parts", '"set_plan"',              '"create_plan"')              WHERE "parts" LIKE '%"set_plan"%';
UPDATE "Message" SET "parts" = replace("parts", '"draft_step"',            '"define_step"')              WHERE "parts" LIKE '%"draft_step"%';
UPDATE "Message" SET "parts" = replace("parts", '"finalize_draft"',        '"validate_draft"')           WHERE "parts" LIKE '%"finalize_draft"%';
UPDATE "Message" SET "parts" = replace("parts", '"create_workflow_draft"', '"create_workflow"')           WHERE "parts" LIKE '%"create_workflow_draft"%';
UPDATE "Message" SET "parts" = replace("parts", '"update_workflow_draft"', '"update_workflow"')           WHERE "parts" LIKE '%"update_workflow_draft"%';
UPDATE "Message" SET "parts" = replace("parts", '"get_workflow"',          '"load_workflow"')             WHERE "parts" LIKE '%"get_workflow"%';
