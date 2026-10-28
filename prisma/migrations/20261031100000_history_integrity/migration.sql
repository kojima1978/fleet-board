BEGIN;

-- Do not invent historical names for existing trips. NULL means not captured.
ALTER TABLE "Trip"
  ADD COLUMN "snapshotCapturedAt" TIMESTAMP(3),
  ADD COLUMN "employeeNameAtStart" TEXT,
  ADD COLUMN "employeeCodeAtStart" TEXT,
  ADD COLUMN "departmentNameAtStart" TEXT,
  ADD COLUMN "vehicleNameAtStart" TEXT,
  ADD COLUMN "vehicleCodeAtStart" TEXT,
  ADD COLUMN "plateNumberAtStart" TEXT;

ALTER TABLE "Trip"
  ADD CONSTRAINT "Trip_planned_times_check" CHECK ("plannedEnd" > "plannedStart"),
  ADD CONSTRAINT "Trip_actual_times_check" CHECK ("actualEnd" IS NULL OR ("actualStart" IS NOT NULL AND "actualEnd" >= "actualStart")),
  ADD CONSTRAINT "Trip_state_times_check" CHECK (
    (status IN ('RESERVED', 'CANCELLED') AND "actualStart" IS NULL AND "actualEnd" IS NULL) OR
    (status = 'IN_USE' AND "actualStart" IS NOT NULL AND "actualEnd" IS NULL) OR
    (status = 'COMPLETED' AND "actualStart" IS NOT NULL AND "actualEnd" IS NOT NULL)
  ),
  ADD CONSTRAINT "Trip_return_fuel_check" CHECK ("returnFuelLevel" IS NULL OR "returnFuelLevel" BETWEEN 0 AND 4),
  ADD CONSTRAINT "Trip_previous_fuel_check" CHECK ("previousFuelLevel" IS NULL OR "previousFuelLevel" BETWEEN 0 AND 4),
  ADD CONSTRAINT "Trip_snapshot_complete_check" CHECK (
    ("snapshotCapturedAt" IS NULL AND "employeeNameAtStart" IS NULL AND "employeeCodeAtStart" IS NULL AND "departmentNameAtStart" IS NULL AND "vehicleNameAtStart" IS NULL AND "vehicleCodeAtStart" IS NULL AND "plateNumberAtStart" IS NULL) OR
    ("snapshotCapturedAt" IS NOT NULL AND "actualStart" IS NOT NULL AND "employeeNameAtStart" IS NOT NULL AND "employeeCodeAtStart" IS NOT NULL AND "departmentNameAtStart" IS NOT NULL AND "vehicleNameAtStart" IS NOT NULL AND "vehicleCodeAtStart" IS NOT NULL AND "plateNumberAtStart" IS NOT NULL)
  );

CREATE FUNCTION fleetflow_preserve_trip_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."snapshotCapturedAt" IS NOT NULL AND ROW(OLD."snapshotCapturedAt", OLD."employeeNameAtStart", OLD."employeeCodeAtStart", OLD."departmentNameAtStart", OLD."vehicleNameAtStart", OLD."vehicleCodeAtStart", OLD."plateNumberAtStart") IS DISTINCT FROM ROW(NEW."snapshotCapturedAt", NEW."employeeNameAtStart", NEW."employeeCodeAtStart", NEW."departmentNameAtStart", NEW."vehicleNameAtStart", NEW."vehicleCodeAtStart", NEW."plateNumberAtStart") THEN
    RAISE EXCEPTION '利用開始時点の履歴情報は変更できません' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Trip_preserve_snapshot" BEFORE UPDATE ON "Trip" FOR EACH ROW EXECUTE FUNCTION fleetflow_preserve_trip_snapshot();

ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_fuel_check" CHECK ("fuelLevel" IS NULL OR "fuelLevel" BETWEEN 0 AND 4);
ALTER TABLE "VehicleMaintenance"
  ADD CONSTRAINT "Maintenance_planned_times_check" CHECK ("plannedEnd" IS NULL OR "plannedEnd" > "plannedStart"),
  ADD CONSTRAINT "Maintenance_actual_times_check" CHECK ("actualEnd" IS NULL OR ("actualStart" IS NOT NULL AND "actualEnd" >= "actualStart")),
  ADD CONSTRAINT "Maintenance_state_times_check" CHECK (
    (status IN ('SCHEDULED', 'CANCELLED') AND "actualStart" IS NULL AND "actualEnd" IS NULL) OR
    (status = 'ACTIVE' AND "actualStart" IS NOT NULL AND "actualEnd" IS NULL) OR
    (status = 'COMPLETED' AND "actualStart" IS NOT NULL AND "actualEnd" IS NOT NULL)
  );

ALTER TABLE "NfcAssignment"
  DROP CONSTRAINT IF EXISTS "NfcAssignment_exactly_one_owner_check",
  ADD CONSTRAINT "NfcAssignment_exactly_one_owner_check" CHECK (("employeeId" IS NOT NULL)::int + ("vehicleId" IS NOT NULL)::int = 1),
  ADD CONSTRAINT "NfcAssignment_times_check" CHECK ("validTo" IS NULL OR "validTo" >= "validFrom");
ALTER TABLE "NfcAssignment" DROP CONSTRAINT "NfcAssignment_employeeId_fkey", DROP CONSTRAINT "NfcAssignment_vehicleId_fkey";
ALTER TABLE "NfcAssignment"
  ADD CONSTRAINT "NfcAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "NfcAssignment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Both directions of the parking/vehicle reference must survive JSON restore.
-- Checking this FK at commit allows spots to be inserted before vehicles.
ALTER TABLE "ParkingSpot"
  ADD CONSTRAINT "ParkingSpot_dedicatedVehicleId_fkey" FOREIGN KEY ("dedicatedVehicleId") REFERENCES "Vehicle"(id) ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT "ParkingSpot_dedicated_role_check" CHECK ((role = 'DEDICATED' AND "dedicatedVehicleId" IS NOT NULL) OR (role <> 'DEDICATED' AND "dedicatedVehicleId" IS NULL));

CREATE UNIQUE INDEX "Trip_one_in_use_vehicle_key" ON "Trip"("vehicleId") WHERE status = 'IN_USE';
CREATE UNIQUE INDEX "Trip_one_in_use_employee_key" ON "Trip"("employeeId") WHERE status = 'IN_USE';
CREATE UNIQUE INDEX "Maintenance_one_active_vehicle_key" ON "VehicleMaintenance"("vehicleId") WHERE status = 'ACTIVE';

-- These indexes previously depended on startup scripts. They now belong to migrations.
CREATE UNIQUE INDEX IF NOT EXISTS "Employee_one_active_number_key" ON "Employee"("employeeNumberId") WHERE active = true;
CREATE UNIQUE INDEX IF NOT EXISTS "Vehicle_one_active_number_key" ON "Vehicle"("vehicleNumberId") WHERE active = true;
CREATE UNIQUE INDEX IF NOT EXISTS "NfcAssignment_one_active_employee_key" ON "NfcAssignment"("employeeId") WHERE "validTo" IS NULL AND "employeeId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "NfcAssignment_one_active_vehicle_key" ON "NfcAssignment"("vehicleId") WHERE "validTo" IS NULL AND "vehicleId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "NfcAssignment_one_active_tag_key" ON "NfcAssignment"("nfcTagId") WHERE "validTo" IS NULL;

CREATE INDEX "Trip_vehicleId_actualStart_id_idx" ON "Trip"("vehicleId", "actualStart", id);
CREATE INDEX "Trip_employeeId_status_idx" ON "Trip"("employeeId", status);
CREATE INDEX "AuditLog_targetType_targetId_createdAt_idx" ON "AuditLog"("targetType", "targetId", "createdAt");
COMMIT;
