import { readFile } from "node:fs/promises";
import pg from "pg";

// 旧形式の番号を手動で整える場合の互換ツール。通常は開発・本番とも番号付きSQL移行を使う。
const sql = await readFile(new URL("../../prisma/migrations/20261027100000_fix_record_code_format/migration.sql", import.meta.url), "utf8");
const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(sql);
  console.log("Employee and vehicle numbers use one letter and three digits.");
} finally {
  await client.end();
}
