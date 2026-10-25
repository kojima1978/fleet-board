ALTER TABLE "Employee" ADD COLUMN "qrToken" TEXT;
ALTER TABLE "Vehicle" ADD COLUMN "qrToken" TEXT;

UPDATE "Employee"
SET "qrToken" = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 20))
WHERE "qrToken" IS NULL;

UPDATE "Vehicle"
SET "qrToken" = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 20))
WHERE "qrToken" IS NULL;

ALTER TABLE "Employee" ALTER COLUMN "qrToken" SET NOT NULL;
ALTER TABLE "Vehicle" ALTER COLUMN "qrToken" SET NOT NULL;

CREATE UNIQUE INDEX "Employee_qrToken_key" ON "Employee"("qrToken");
CREATE UNIQUE INDEX "Vehicle_qrToken_key" ON "Vehicle"("qrToken");
