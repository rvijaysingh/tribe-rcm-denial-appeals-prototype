-- Rename the synthetic payer meridian -> pinnacle.
--
-- drizzle-kit generates a drop and recreate for an enum value change. That
-- fails on any database still holding rows labeled 'meridian', because the
-- recreated type has no such label to cast to. Renaming the label in place
-- preserves every row, so this file replaces the generated statements.
--
-- The snapshot in drizzle/meta for this migration is the generated one and is
-- correct: it describes the resulting schema.
ALTER TYPE "public"."payer_id" RENAME VALUE 'meridian' TO 'pinnacle';
