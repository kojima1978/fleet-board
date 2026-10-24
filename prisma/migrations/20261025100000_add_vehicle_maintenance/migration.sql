CREATE TYPE "MaintenanceKind" AS ENUM ('ON_SITE', 'OFF_SITE');

CREATE TYPE "MaintenanceStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

CREATE TABLE "VehicleMaintenance" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "kind" "MaintenanceKind" NOT NULL,
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'SCHEDULED',
    "note" TEXT,
    "plannedStart" TIMESTAMP(3) NOT NULL,
    "plannedEnd" TIMESTAMP(3),
    "actualStart" TIMESTAMP(3),
    "actualEnd" TIMESTAMP(3),
    "returnSpotCode" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleMaintenance_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VehicleMaintenance_vehicleId_status_idx" ON "VehicleMaintenance"("vehicleId", "status");

CREATE INDEX "VehicleMaintenance_plannedStart_plannedEnd_idx" ON "VehicleMaintenance"("plannedStart", "plannedEnd");

ALTER TABLE "VehicleMaintenance" ADD CONSTRAINT "VehicleMaintenance_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- すでに整備中の車両は、駐車場内の整備として記録を引き継ぐ。
INSERT INTO "VehicleMaintenance" ("id", "vehicleId", "kind", "status", "plannedStart", "actualStart", "updatedAt")
SELECT 'legacy-' || "id", "id", 'ON_SITE', 'ACTIVE', "updatedAt", "updatedAt", CURRENT_TIMESTAMP
FROM "Vehicle"
WHERE "status" = 'MAINTENANCE';
