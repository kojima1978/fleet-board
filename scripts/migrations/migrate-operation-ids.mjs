import pg from "pg";

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "operationId" TEXT');
  await client.query('CREATE UNIQUE INDEX IF NOT EXISTS "AuditLog_operationId_key" ON "AuditLog"("operationId")');
  await client.query('CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt")');
  console.log("Audit log operation IDs enabled.");
} finally {
  await client.end();
}
