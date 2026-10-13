import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const { rows: [state] } = await client.query(`SELECT to_regclass('public."Employee"') IS NOT NULL AS "schemaExists"`);
  process.stdout.write(state.schemaExists ? "existing" : "empty");
} finally {
  await client.end();
}
