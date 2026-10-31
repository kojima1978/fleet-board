ALTER TABLE "FuelReturnNotice"
ADD COLUMN "parkingAnimationEnabled" BOOLEAN NOT NULL DEFAULT false;

-- 満タンで返却したときだけ、初期状態で区画の給油演出を使用する。
UPDATE "FuelReturnNotice"
SET "parkingAnimationEnabled" = true
WHERE "level" = 4;
