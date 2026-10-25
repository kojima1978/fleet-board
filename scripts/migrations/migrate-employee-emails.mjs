import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const { rows: [state] } = await client.query(`SELECT to_regclass('public."Employee"') IS NOT NULL AS "employeesExist"`);
  if (!state.employeesExist) process.exit(0);
  await client.query("BEGIN");
  await client.query('ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "email" TEXT');
  await client.query('UPDATE "Employee" SET "email" = lower(trim("email")) WHERE "email" IS NOT NULL');
  const { rows: duplicates } = await client.query('SELECT "email" FROM "Employee" WHERE "email" IS NOT NULL GROUP BY "email" HAVING count(*) > 1 LIMIT 1');
  if (duplicates.length) throw new Error(`Duplicate employee email exists: ${duplicates[0].email}`);
  await client.query('CREATE UNIQUE INDEX IF NOT EXISTS "Employee_email_key" ON "Employee"("email")');
  await client.query("COMMIT");
  console.log("Employee email addresses are ready.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
