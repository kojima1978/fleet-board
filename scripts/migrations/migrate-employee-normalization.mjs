import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();
  const { rows: [state] } = await client.query(`
    SELECT
      to_regclass('public."Employee"') IS NOT NULL AS "employeeExists",
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'Employee' AND column_name = 'department'
      ) AS "legacyDepartmentExists",
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'Employee' AND column_name = 'nfcUid'
      ) AS "legacyNfcExists",
      to_regclass('public."NfcAssignment"') IS NOT NULL AS "unifiedNfcExists"
  `);
  if (!state.employeeExists) return;

  await client.query("BEGIN");
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "Department" (
        "id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "active" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
      )
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS "Department_name_key" ON "Department"("name")`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS "NfcTag" (
        "id" TEXT NOT NULL,
        "uid" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "NfcTag_pkey" PRIMARY KEY ("id")
      )
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS "NfcTag_uid_key" ON "NfcTag"("uid")`);
    if (!state.unifiedNfcExists) await client.query(`
      CREATE TABLE IF NOT EXISTS "EmployeeNfcAssignment" (
        "id" TEXT NOT NULL,
        "employeeId" TEXT NOT NULL,
        "nfcTagId" TEXT NOT NULL,
        "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "validTo" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "EmployeeNfcAssignment_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "EmployeeNfcAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "EmployeeNfcAssignment_nfcTagId_fkey" FOREIGN KEY ("nfcTagId") REFERENCES "NfcTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE
      )
    `);
    await client.query(`ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "departmentId" TEXT`);

    if (state.legacyDepartmentExists) {
      await client.query(`
        INSERT INTO "Department" ("id", "name")
        SELECT 'dep_' || md5(trim("department")), trim("department")
        FROM "Employee"
        WHERE trim("department") <> ''
        GROUP BY trim("department")
        ON CONFLICT ("name") DO NOTHING
      `);
      await client.query(`
        UPDATE "Employee" AS employee
        SET "departmentId" = department."id"
        FROM "Department" AS department
        WHERE department."name" = trim(employee."department") AND employee."departmentId" IS NULL
      `);
    }

    if (state.legacyNfcExists) {
      await client.query(`
        INSERT INTO "NfcTag" ("id", "uid")
        SELECT 'tag_' || md5("nfcUid"), "nfcUid"
        FROM "Employee"
        ON CONFLICT ("uid") DO NOTHING
      `);
      await client.query(`
        INSERT INTO "EmployeeNfcAssignment" ("id", "employeeId", "nfcTagId", "validFrom", "validTo")
        SELECT
          'ena_' || md5(employee."id" || ':' || tag."id"),
          employee."id",
          tag."id",
          employee."createdAt",
          CASE WHEN employee."active" THEN NULL ELSE employee."updatedAt" END
        FROM "Employee" AS employee
        JOIN "NfcTag" AS tag ON tag."uid" = employee."nfcUid"
        ON CONFLICT ("id") DO NOTHING
      `);
    }

    const { rows: [missing] } = await client.query(`SELECT COUNT(*)::int AS count FROM "Employee" WHERE "departmentId" IS NULL`);
    if (missing.count > 0) throw new Error("部署を移行できない社員があります");
    await client.query(`ALTER TABLE "Employee" ALTER COLUMN "departmentId" SET NOT NULL`);
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Employee_departmentId_fkey') THEN
          ALTER TABLE "Employee" ADD CONSTRAINT "Employee_departmentId_fkey"
          FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
        END IF;
      END $$
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS "Employee_departmentId_idx" ON "Employee"("departmentId")`);
    if (!state.unifiedNfcExists) {
      await client.query(`CREATE INDEX IF NOT EXISTS "EmployeeNfcAssignment_employeeId_validTo_idx" ON "EmployeeNfcAssignment"("employeeId", "validTo")`);
      await client.query(`CREATE INDEX IF NOT EXISTS "EmployeeNfcAssignment_nfcTagId_validTo_idx" ON "EmployeeNfcAssignment"("nfcTagId", "validTo")`);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS "EmployeeNfcAssignment_one_active_employee_key" ON "EmployeeNfcAssignment"("employeeId") WHERE "validTo" IS NULL`);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS "EmployeeNfcAssignment_one_active_tag_key" ON "EmployeeNfcAssignment"("nfcTagId") WHERE "validTo" IS NULL`);
    }
    await client.query(`ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "actorEmployeeId" TEXT`);
    await client.query(`
      UPDATE "AuditLog" AS log
      SET "actorEmployeeId" = employee."id"
      FROM "Employee" AS employee
      WHERE log."actorEmployeeId" IS NULL
        AND log."actorName" = employee."name"
        AND NOT EXISTS (SELECT 1 FROM "Employee" duplicate WHERE duplicate."name" = employee."name" AND duplicate."id" <> employee."id")
    `);
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AuditLog_actorEmployeeId_fkey') THEN
          ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorEmployeeId_fkey"
          FOREIGN KEY ("actorEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;
      END $$
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS "AuditLog_actorEmployeeId_idx" ON "AuditLog"("actorEmployeeId")`);

    if (state.legacyDepartmentExists) await client.query(`ALTER TABLE "Employee" DROP COLUMN "department"`);
    if (state.legacyNfcExists) {
      await client.query(`DROP INDEX IF EXISTS "Employee_nfcUid_key"`);
      await client.query(`ALTER TABLE "Employee" DROP COLUMN "nfcUid"`);
    }
    await client.query("COMMIT");
    console.log("Employee departments and NFC assignments normalized.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

main().finally(() => client.end());
