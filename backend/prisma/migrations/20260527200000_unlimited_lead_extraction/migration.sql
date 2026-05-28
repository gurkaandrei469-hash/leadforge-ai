-- Lead extraction quota removed. Existing teams (which were seeded with
-- creditsTotal=100) are bumped to the new effectively-unlimited default so the
-- /me endpoint and dashboard widget show a sensible remaining balance even
-- though no code path gates on it anymore.

ALTER TABLE "Team" ALTER COLUMN "creditsTotal" SET DEFAULT 999999999;

UPDATE "Team" SET "creditsTotal" = 999999999 WHERE "creditsTotal" <= 100000;
