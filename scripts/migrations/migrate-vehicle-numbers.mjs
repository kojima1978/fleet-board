import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();
  const { rows: [state] } = await client.query(`
    SELECT
      to_regclass('public."Vehicle"') IS NOT NULL AS "vehicleExists",
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'Vehicle' AND column_name = 'code'
      ) AS "legacyCodeExists"
  `);
  if (!state.vehicleExists) return;
  if (!state.legacyCodeExists) {
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS "Vehicle_one_active_number_key" ON "Vehicle"("vehicleNumberId") WHERE "active" = true`);
    return;
  }

  await client.query("BEGIN");
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "VehicleNumber" (
        "id" TEXT NOT NULL,
        "code" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "VehicleNumber_pkey" PRIMARY KEY ("id")
      )
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS "VehicleNumber_code_key" ON "VehicleNumber"("code")`);
    await client.query(`ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "vehicleNumberId" TEXT`);
    await client.query(`
      INSERT INTO "VehicleNumber" ("id", "code")
      SELECT 'vn_' || md5("code"), "code" FROM "Vehicle"
      ON CONFLICT ("code") DO NOTHING
    `);
    await client.query(`
      UPDATE "Vehicle" AS vehicle
      SET "vehicleNumberId" = number."id"
      FROM "VehicleNumber" AS number
      WHERE vehicle."code" = number."code" AND vehicle."vehicleNumberId" IS NULL
    `);
    const { rows: [missing] } = await client.query(`SELECT COUNT(*)::int AS count FROM "Vehicle" WHERE "vehicleNumberId" IS NULL`);
    if (missing.count > 0) throw new Error("車両番号を移行できない車両があります");
    await client.query(`ALTER TABLE "Vehicle" ALTER COLUMN "vehicleNumberId" SET NOT NULL`);
    await client.query(`DROP INDEX IF EXISTS "Vehicle_code_key"`);
    await client.query(`ALTER TABLE "Vehicle" DROP COLUMN "code"`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS "Vehicle_one_active_number_key" ON "Vehicle"("vehicleNumberId") WHERE "active" = true`);
    await client.query("COMMIT");
    console.log("Vehicle numbers migrated to VehicleNumber master.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

main().finally(() => client.end());
