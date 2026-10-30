ALTER TABLE "FuelReturnNotice" ADD COLUMN "displayMode" TEXT NOT NULL DEFAULT 'MODAL';

UPDATE "FuelReturnNotice"
SET "displayMode" = CASE
  WHEN "enabled" = false THEN 'NONE'
  WHEN "animated" = false THEN 'MESSAGE'
  ELSE 'MODAL'
END;

ALTER TABLE "FuelReturnNotice"
ADD CONSTRAINT "FuelReturnNotice_displayMode_check"
CHECK ("displayMode" IN ('NONE', 'MESSAGE', 'EMPHASIZED', 'MODAL'));
