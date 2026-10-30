CREATE TABLE "FuelReturnNotice" (
  "level" INTEGER PRIMARY KEY CHECK ("level" IN (0, 1)),
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "message" TEXT NOT NULL CHECK (char_length("message") BETWEEN 1 AND 500),
  "audioBase64" TEXT,
  "audioMime" TEXT,
  "audioName" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FuelReturnNotice_audio_check" CHECK (
    ("audioBase64" IS NULL AND "audioMime" IS NULL AND "audioName" IS NULL) OR
    ("audioBase64" IS NOT NULL AND "audioMime" IS NOT NULL AND "audioMime" IN ('audio/mpeg', 'audio/wav') AND "audioName" IS NOT NULL)
  )
);
