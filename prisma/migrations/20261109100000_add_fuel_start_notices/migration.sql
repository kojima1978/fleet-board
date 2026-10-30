CREATE TABLE "FuelStartNotice" (
  "level" INTEGER NOT NULL,
  "displayMode" TEXT NOT NULL DEFAULT 'NONE',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "animated" BOOLEAN NOT NULL DEFAULT false,
  "audioEnabled" BOOLEAN NOT NULL DEFAULT false,
  "message" TEXT NOT NULL,
  "audioBase64" TEXT,
  "audioMime" TEXT,
  "audioName" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FuelStartNotice_pkey" PRIMARY KEY ("level"),
  CONSTRAINT "FuelStartNotice_displayMode_check" CHECK ("displayMode" IN ('NONE', 'MESSAGE', 'EMPHASIZED', 'MODAL'))
);
