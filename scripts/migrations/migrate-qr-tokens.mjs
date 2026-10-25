import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const { rows: [state] } = await client.query(`
    SELECT to_regclass('public."Employee"') IS NOT NULL AS "employeesExist",
           to_regclass('public."Vehicle"') IS NOT NULL AS "vehiclesExist"
  `);
  if (!state.employeesExist || !state.vehiclesExist) process.exit(0);
  await client.query("BEGIN");
  await client.query('ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "qrToken" TEXT');
  await client.query('ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "qrToken" TEXT');
  await client.query(`UPDATE "Employee" SET "qrToken" = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 20)) WHERE "qrToken" IS NULL`);
  await client.query(`UPDATE "Vehicle" SET "qrToken" = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 20)) WHERE "qrToken" IS NULL`);
  await client.query('ALTER TABLE "Employee" ALTER COLUMN "qrToken" SET NOT NULL');
  await client.query('ALTER TABLE "Vehicle" ALTER COLUMN "qrToken" SET NOT NULL');
  await client.query('CREATE UNIQUE INDEX IF NOT EXISTS "Employee_qrToken_key" ON "Employee"("qrToken")');
  await client.query('CREATE UNIQUE INDEX IF NOT EXISTS "Vehicle_qrToken_key" ON "Vehicle"("qrToken")');
  await client.query("COMMIT");
  console.log("QR tokens are ready.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
