import pg from "pg";

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
const normalize = (value) => {
  const trimmed = value.trim().toUpperCase();
  const compact = trimmed.replace(/[\s:-]/g, "");
  return compact.length >= 8 && compact.length % 2 === 0 && /^[0-9A-F]+$/.test(compact) ? compact : trimmed;
};

await client.connect();
try {
  const { rows: [state] } = await client.query(`
    SELECT
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Employee' AND column_name = 'nfcUid') AS "legacyEmployeeNfc",
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Vehicle' AND column_name = 'nfcUid') AS "legacyVehicleNfc",
      to_regclass('public."NfcTag"') IS NOT NULL AS "nfcTagExists"
  `);
  const employeeSource = state.legacyEmployeeNfc
    ? `SELECT 'Employee' AS type, id, "nfcUid" AS uid FROM "Employee"`
    : state.nfcTagExists
      ? `SELECT 'NfcTag' AS type, id, uid FROM "NfcTag"`
      : `SELECT 'NfcTag' AS type, NULL::text AS id, NULL::text AS uid WHERE false`;
  const vehicleSource = state.legacyVehicleNfc
    ? `SELECT 'Vehicle' AS type, id, "nfcUid" AS uid FROM "Vehicle"`
    : `SELECT 'Vehicle' AS type, NULL::text AS id, NULL::text AS uid WHERE false`;
  const { rows } = await client.query(`${employeeSource} UNION ALL ${vehicleSource}`);
  const owners = new Map();
  for (const row of rows) {
    const normalized = normalize(row.uid);
    const previous = owners.get(normalized);
    if (previous) throw new Error(`NFC UID ${normalized} が ${previous.type} と ${row.type} で重複しています`);
    owners.set(normalized, row);
  }
  await client.query("BEGIN");
  for (const row of rows) {
    const normalized = normalize(row.uid);
    if (normalized === row.uid) continue;
    const column = row.type === "NfcTag" ? "uid" : "nfcUid";
    await client.query(`UPDATE "${row.type}" SET "${column}" = $1 WHERE id = $2`, [normalized, row.id]);
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end();
}
