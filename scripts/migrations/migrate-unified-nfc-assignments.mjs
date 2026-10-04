import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();
  const { rows: [state] } = await client.query(`
    SELECT
      to_regclass('public."Employee"') IS NOT NULL AS "employeeExists",
      to_regclass('public."Vehicle"') IS NOT NULL AS "vehicleExists",
      to_regclass('public."EmployeeNfcAssignment"') IS NOT NULL AS "legacyAssignmentExists",
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'Vehicle' AND column_name = 'nfcUid'
      ) AS "legacyVehicleNfcExists"
  `);
  if (!state.employeeExists || !state.vehicleExists) return;

  await client.query("BEGIN");
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "NfcAssignment" (
        "id" TEXT NOT NULL,
        "employeeId" TEXT,
        "vehicleId" TEXT,
        "nfcTagId" TEXT NOT NULL,
        "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "validTo" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "NfcAssignment_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "NfcAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "NfcAssignment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "NfcAssignment_nfcTagId_fkey" FOREIGN KEY ("nfcTagId") REFERENCES "NfcTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "NfcAssignment_exactly_one_owner_check" CHECK (("employeeId" IS NOT NULL)::int + ("vehicleId" IS NOT NULL)::int = 1)
      )
    `);

    if (state.legacyAssignmentExists) {
      await client.query(`
        INSERT INTO "NfcAssignment" ("id", "employeeId", "nfcTagId", "validFrom", "validTo", "createdAt")
        SELECT 'nfa_' || md5("id"), "employeeId", "nfcTagId", "validFrom", "validTo", "createdAt"
        FROM "EmployeeNfcAssignment"
        ON CONFLICT ("id") DO NOTHING
      `);
    }

    if (state.legacyVehicleNfcExists) {
      await client.query(`
        INSERT INTO "NfcTag" ("id", "uid", "createdAt", "updatedAt")
        SELECT 'tag_' || md5("nfcUid"), "nfcUid", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "Vehicle"
        ON CONFLICT ("uid") DO NOTHING
      `);
      await client.query(`
        INSERT INTO "NfcAssignment" ("id", "vehicleId", "nfcTagId", "validFrom", "validTo")
        SELECT
          'nfa_' || md5(vehicle."id" || ':' || tag."id"),
          vehicle."id",
          tag."id",
          vehicle."createdAt",
          CASE WHEN vehicle."active" THEN NULL ELSE vehicle."updatedAt" END
        FROM "Vehicle" AS vehicle
        JOIN "NfcTag" AS tag ON tag."uid" = vehicle."nfcUid"
        ON CONFLICT ("id") DO NOTHING
      `);
    }

    const { rows: [duplicate] } = await client.query(`
      SELECT COUNT(*)::int AS count FROM (
        SELECT "nfcTagId" FROM "NfcAssignment" WHERE "validTo" IS NULL GROUP BY "nfcTagId" HAVING COUNT(*) > 1
      ) duplicated
    `);
    if (duplicate.count > 0) throw new Error("同時利用中のNFC UIDが社員と車両で重複しています");

    await client.query(`CREATE INDEX IF NOT EXISTS "NfcAssignment_employeeId_validTo_idx" ON "NfcAssignment"("employeeId", "validTo")`);
    await client.query(`CREATE INDEX IF NOT EXISTS "NfcAssignment_vehicleId_validTo_idx" ON "NfcAssignment"("vehicleId", "validTo")`);
    await client.query(`CREATE INDEX IF NOT EXISTS "NfcAssignment_nfcTagId_validTo_idx" ON "NfcAssignment"("nfcTagId", "validTo")`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS "NfcAssignment_one_active_employee_key" ON "NfcAssignment"("employeeId") WHERE "validTo" IS NULL AND "employeeId" IS NOT NULL`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS "NfcAssignment_one_active_vehicle_key" ON "NfcAssignment"("vehicleId") WHERE "validTo" IS NULL AND "vehicleId" IS NOT NULL`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS "NfcAssignment_one_active_tag_key" ON "NfcAssignment"("nfcTagId") WHERE "validTo" IS NULL`);

    if (state.legacyAssignmentExists) await client.query(`DROP TABLE "EmployeeNfcAssignment"`);
    if (state.legacyVehicleNfcExists) {
      await client.query(`DROP INDEX IF EXISTS "Vehicle_nfcUid_key"`);
      await client.query(`ALTER TABLE "Vehicle" DROP COLUMN "nfcUid"`);
    }
    await client.query("COMMIT");
    console.log("Employee and vehicle NFC assignments unified.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

main().finally(() => client.end());
