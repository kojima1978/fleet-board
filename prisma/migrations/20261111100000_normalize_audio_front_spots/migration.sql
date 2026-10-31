-- 案内・お礼の音声を共通の表へ移し、base64の文字列ではなくバイナリで持つ。
CREATE TABLE "NoticeAudio" (
  "id" TEXT NOT NULL,
  "data" BYTEA NOT NULL,
  "mime" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NoticeAudio_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NoticeAudio_mime_check" CHECK ("mime" IN ('audio/mpeg', 'audio/wav')),
  CONSTRAINT "NoticeAudio_data_check" CHECK (octet_length("data") BETWEEN 1 AND 2097152),
  CONSTRAINT "NoticeAudio_name_check" CHECK (char_length("name") BETWEEN 1 AND 100)
);

ALTER TABLE "FuelReturnNotice" ADD COLUMN "audioId" TEXT;
ALTER TABLE "FuelStartNotice" ADD COLUMN "audioId" TEXT;
ALTER TABLE "FuelThankYouSetting" ADD COLUMN "audioId" TEXT;
ALTER TABLE "ParkingGuidanceSetting" ADD COLUMN "audioId" TEXT;

UPDATE "FuelReturnNotice" SET "audioId" = gen_random_uuid()::text WHERE "audioBase64" IS NOT NULL AND "audioMime" IS NOT NULL;
UPDATE "FuelStartNotice" SET "audioId" = gen_random_uuid()::text WHERE "audioBase64" IS NOT NULL AND "audioMime" IS NOT NULL;
UPDATE "FuelThankYouSetting" SET "audioId" = gen_random_uuid()::text WHERE "audioBase64" IS NOT NULL AND "audioMime" IS NOT NULL;
UPDATE "ParkingGuidanceSetting" SET "audioId" = gen_random_uuid()::text WHERE "audioBase64" IS NOT NULL AND "audioMime" IS NOT NULL;

INSERT INTO "NoticeAudio" ("id", "data", "mime", "name")
SELECT "audioId", decode("audioBase64", 'base64'), "audioMime", left(coalesce(nullif("audioName", ''), '音声'), 100) FROM "FuelReturnNotice" WHERE "audioId" IS NOT NULL
UNION ALL
SELECT "audioId", decode("audioBase64", 'base64'), "audioMime", left(coalesce(nullif("audioName", ''), '音声'), 100) FROM "FuelStartNotice" WHERE "audioId" IS NOT NULL
UNION ALL
SELECT "audioId", decode("audioBase64", 'base64'), "audioMime", left(coalesce(nullif("audioName", ''), '音声'), 100) FROM "FuelThankYouSetting" WHERE "audioId" IS NOT NULL
UNION ALL
SELECT "audioId", decode("audioBase64", 'base64'), "audioMime", left(coalesce(nullif("audioName", ''), '音声'), 100) FROM "ParkingGuidanceSetting" WHERE "audioId" IS NOT NULL;

ALTER TABLE "FuelReturnNotice" DROP CONSTRAINT IF EXISTS "FuelReturnNotice_audio_check", DROP COLUMN "audioBase64", DROP COLUMN "audioMime", DROP COLUMN "audioName";
ALTER TABLE "FuelStartNotice" DROP COLUMN "audioBase64", DROP COLUMN "audioMime", DROP COLUMN "audioName";
ALTER TABLE "FuelThankYouSetting" DROP COLUMN "audioBase64", DROP COLUMN "audioMime", DROP COLUMN "audioName";
ALTER TABLE "ParkingGuidanceSetting" DROP CONSTRAINT IF EXISTS "ParkingGuidanceSetting_audio_check", DROP COLUMN "audioBase64", DROP COLUMN "audioMime", DROP COLUMN "audioName";

CREATE UNIQUE INDEX "FuelReturnNotice_audioId_key" ON "FuelReturnNotice"("audioId");
CREATE UNIQUE INDEX "FuelStartNotice_audioId_key" ON "FuelStartNotice"("audioId");
CREATE UNIQUE INDEX "FuelThankYouSetting_audioId_key" ON "FuelThankYouSetting"("audioId");
CREATE UNIQUE INDEX "ParkingGuidanceSetting_audioId_key" ON "ParkingGuidanceSetting"("audioId");
ALTER TABLE "FuelReturnNotice" ADD CONSTRAINT "FuelReturnNotice_audioId_fkey" FOREIGN KEY ("audioId") REFERENCES "NoticeAudio"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FuelStartNotice" ADD CONSTRAINT "FuelStartNotice_audioId_fkey" FOREIGN KEY ("audioId") REFERENCES "NoticeAudio"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FuelThankYouSetting" ADD CONSTRAINT "FuelThankYouSetting_audioId_fkey" FOREIGN KEY ("audioId") REFERENCES "NoticeAudio"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ParkingGuidanceSetting" ADD CONSTRAINT "ParkingGuidanceSetting_audioId_fkey" FOREIGN KEY ("audioId") REFERENCES "NoticeAudio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 手前の区画をID配列から中間表へ移し、参照先の区画をDBで保証する。
CREATE TABLE "ParkingSpotFront" (
  "spotId" TEXT NOT NULL,
  "frontSpotId" TEXT NOT NULL,
  CONSTRAINT "ParkingSpotFront_pkey" PRIMARY KEY ("spotId", "frontSpotId"),
  CONSTRAINT "ParkingSpotFront_not_self_check" CHECK ("spotId" <> "frontSpotId")
);
CREATE INDEX "ParkingSpotFront_frontSpotId_idx" ON "ParkingSpotFront"("frontSpotId");
ALTER TABLE "ParkingSpotFront" ADD CONSTRAINT "ParkingSpotFront_spotId_fkey" FOREIGN KEY ("spotId") REFERENCES "ParkingSpot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ParkingSpotFront" ADD CONSTRAINT "ParkingSpotFront_frontSpotId_fkey" FOREIGN KEY ("frontSpotId") REFERENCES "ParkingSpot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 存在しない区画・自分自身を指すIDは移さない。
INSERT INTO "ParkingSpotFront" ("spotId", "frontSpotId")
SELECT DISTINCT s."id", f."frontSpotId"
FROM "ParkingSpot" s CROSS JOIN LATERAL unnest(s."frontSpotIds") AS f("frontSpotId")
WHERE f."frontSpotId" <> s."id" AND EXISTS (SELECT 1 FROM "ParkingSpot" t WHERE t."id" = f."frontSpotId");

ALTER TABLE "ParkingSpot" DROP COLUMN "frontSpotIds";

-- 区画の向きを決まった値だけにする。画面は横向き以外を縦向きとして描いていたため、それ以外の値は縦向きにそろえる。
CREATE TYPE "ParkingSpotOrientation" AS ENUM ('vertical', 'horizontal');
ALTER TABLE "ParkingSpot" ALTER COLUMN "orientation" TYPE "ParkingSpotOrientation"
  USING (CASE WHEN "orientation" = 'horizontal' THEN 'horizontal' ELSE 'vertical' END)::"ParkingSpotOrientation";
