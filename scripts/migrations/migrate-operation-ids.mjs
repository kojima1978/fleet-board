import pg from "pg";

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const { rows: [state] } = await client.query(`SELECT to_regclass('public."AuditLog"') IS NOT NULL AS "auditLogExists"`);
  if (!state.auditLogExists) {
    console.log("AuditLog does not exist yet; operation ID migration will run after schema creation.");
    process.exitCode = 0;
  } else {
    await client.query('ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "operationId" TEXT');
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS "AuditLog_operationId_key" ON "AuditLog"("operationId")');
    await client.query('CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt")');
    console.log("Audit log operation IDs enabled.");
  }
} finally {
  await client.end();
}
