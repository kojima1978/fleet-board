import { execFileSync } from "node:child_process";
import pg from "pg";

const migrationName = "20261004130000_baseline";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

await client.connect();
try {
  const { rows: [state] } = await client.query(`
    SELECT
      to_regclass('public."Employee"') IS NOT NULL AS "schemaExists",
      to_regclass('public."_prisma_migrations"') IS NOT NULL AS "historyExists"
  `);
  if (state.schemaExists && !state.historyExists) {
    console.log(`Registering existing schema as ${migrationName}.`);
    execFileSync("npx", ["prisma", "migrate", "resolve", "--applied", migrationName], { stdio: "inherit" });
  }
}
finally {
  await client.end();
}
