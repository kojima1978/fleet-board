CREATE TABLE IF NOT EXISTS "ParkingGuidanceSetting" (
  "event" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "message" TEXT NOT NULL,
  "audioBase64" TEXT,
  "audioMime" TEXT,
  "audioName" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ParkingGuidanceSetting_pkey" PRIMARY KEY ("event"),
  CONSTRAINT "ParkingGuidanceSetting_audio_check" CHECK (
    ("audioBase64" IS NULL AND "audioMime" IS NULL AND "audioName" IS NULL) OR
    ("audioBase64" IS NOT NULL AND "audioMime" IN ('audio/mpeg', 'audio/wav') AND "audioName" IS NOT NULL)
  )
);
