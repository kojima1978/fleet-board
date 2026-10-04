import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();
  const { rows: [state] } = await client.query(`
    SELECT
      to_regclass('public."Employee"') IS NOT NULL AS "employeeExists",
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'Employee' AND column_name = 'code'
      ) AS "legacyCodeExists"
  `);
  if (!state.employeeExists) return;
  if (!state.legacyCodeExists) {
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS "Employee_one_active_number_key" ON "Employee"("employeeNumberId") WHERE "active" = true`);
    return;
  }

  await client.query("BEGIN");
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "EmployeeNumber" (
        "id" TEXT NOT NULL,
        "code" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "EmployeeNumber_pkey" PRIMARY KEY ("id")
      )
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS "EmployeeNumber_code_key" ON "EmployeeNumber"("code")`);
    await client.query(`ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "employeeNumberId" TEXT`);
    await client.query(`
      INSERT INTO "EmployeeNumber" ("id", "code")
      SELECT 'en_' || md5("code"), "code" FROM "Employee"
      ON CONFLICT ("code") DO NOTHING
    `);
    await client.query(`
      UPDATE "Employee" AS employee
      SET "employeeNumberId" = number."id"
      FROM "EmployeeNumber" AS number
      WHERE employee."code" = number."code" AND employee."employeeNumberId" IS NULL
    `);
    const { rows: [missing] } = await client.query(`SELECT COUNT(*)::int AS count FROM "Employee" WHERE "employeeNumberId" IS NULL`);
    if (missing.count > 0) throw new Error("社員番号を移行できない社員があります");
    await client.query(`ALTER TABLE "Employee" ALTER COLUMN "employeeNumberId" SET NOT NULL`);
    await client.query(`DROP INDEX IF EXISTS "Employee_code_key"`);
    await client.query(`ALTER TABLE "Employee" DROP COLUMN "code"`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS "Employee_one_active_number_key" ON "Employee"("employeeNumberId") WHERE "active" = true`);
    await client.query("COMMIT");
    console.log("Employee numbers migrated to EmployeeNumber master.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

main().finally(() => client.end());
