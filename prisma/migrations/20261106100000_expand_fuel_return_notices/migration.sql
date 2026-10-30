ALTER TABLE "FuelReturnNotice"
  ADD COLUMN IF NOT EXISTS "animated" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "FuelReturnNotice"
  DROP CONSTRAINT IF EXISTS "FuelReturnNotice_level_check";

ALTER TABLE "FuelReturnNotice"
  ADD CONSTRAINT "FuelReturnNotice_level_check" CHECK ("level" IN (0, 1, 2, 3, 4));
