import { readFile } from "node:fs/promises";
import pg from "pg";

// 開発環境はdb pushでスキーマを合わせるため、番号形式の移行SQLを初期データの前にここで適用する。
// 本番ではprisma migrate deployが同じSQLを適用する。何度実行しても結果は変わらない。
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
