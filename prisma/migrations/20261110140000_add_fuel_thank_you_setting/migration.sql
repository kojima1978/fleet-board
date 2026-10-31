CREATE TABLE "FuelThankYouSetting" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "audioEnabled" BOOLEAN NOT NULL DEFAULT true,
  "message" TEXT NOT NULL,
  "audioBase64" TEXT,
  "audioMime" TEXT,
  "audioName" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FuelThankYouSetting_pkey" PRIMARY KEY ("id")
);
