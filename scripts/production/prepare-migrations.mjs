import { execFileSync } from "node:child_process";
import pg from "pg";

const migrationName = "20261004130000_baseline";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

// db push was used by earlier development/installations. Register only changes
// whose complete effects already exist; partially installed features need repair.
const legacyFeatures = [
  ["20261008100000_add_vehicle_equipment", "Vehicle", ["hasEtc", "hasNavigation"]],
  ["20261023100000_add_fuel_level", "Vehicle", ["fuelLevel"], "Trip", ["returnFuelLevel", "previousFuelLevel"]],
  ["20261023200000_add_parking_spot_roles", "ParkingSpot", ["role", "dedicatedVehicleId"]],
  ["20261024100000_add_department_order", "Department", ["sortOrder", "version"]],
  ["20261025100000_add_vehicle_maintenance", "VehicleMaintenance", ["id", "vehicleId", "kind", "status", "note", "plannedStart", "plannedEnd", "actualStart", "actualEnd", "returnSpotCode", "version", "createdAt", "updatedAt"]],
  ["20261026100000_add_parking_spot_label", "ParkingSpot", ["label"]],
  ["20261028100000_add_nfc_assignment_cleared", "NfcAssignment", ["cleared"]],
  ["20261029100000_add_qr_tokens", "Employee", ["qrToken"], "Vehicle", ["qrToken"]],
  ["20261030100000_add_employee_email", "Employee", ["email"]],
];
async function featurePresence(feature) {
  const present = [];
  for (let index = 1; index < feature.length; index += 2) {
    const { rows } = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=ANY($2::text[])", [feature[index], feature[index + 1]]);
    const found = new Set(rows.map((row) => row.column_name));
    present.push(...feature[index + 1].map((column) => found.has(column)));
  }
  return present;
}
const featureIndexes = {
  "20261025100000_add_vehicle_maintenance": ["VehicleMaintenance_vehicleId_status_idx", "VehicleMaintenance_plannedStart_plannedEnd_idx"],
  "20261029100000_add_qr_tokens": ["Employee_qrToken_key", "Vehicle_qrToken_key"],
  "20261030100000_add_employee_email": ["Employee_email_key"],
};

await client.connect();
try {
  const { rows: [state] } = await client.query(`
    SELECT
      to_regclass('public."Employee"') IS NOT NULL AS "schemaExists",
      to_regclass('public."_prisma_migrations"') IS NOT NULL AS "historyExists"
  `);
  if (state.schemaExists && !state.historyExists) {
    const baseTables = ["Employee", "EmployeeNumber", "Department", "NfcTag", "NfcAssignment", "Vehicle", "VehicleNumber", "ParkingSpot", "Trip", "AuditLog"];
    const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename=ANY($1::text[])", [baseTables]);
    if (tables.rows.length !== baseTables.length) throw new Error("既存DBの基本テーブルが不足しています。移行前に構成を確認してください");
    const alreadyApplied = [migrationName];
    for (const feature of legacyFeatures) {
      const presence = await featurePresence(feature);
      if (presence.some(Boolean) && !presence.every(Boolean)) throw new Error(`既存DBの構成が途中の状態です: ${feature[0]}`);
      if (presence.every(Boolean)) {
        const requiredIndexes = featureIndexes[feature[0]] ?? [];
        const indexes = await client.query("SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname=ANY($1::text[])", [requiredIndexes]);
        if (indexes.rows.length !== requiredIndexes.length) throw new Error(`既存DBの索引が不足しています: ${feature[0]}`);
        alreadyApplied.push(feature[0]);
      }
    }
    const { rows: checks } = await client.query("SELECT conname FROM pg_constraint WHERE conname=ANY($1::text[])", [["EmployeeNumber_code_format", "VehicleNumber_code_format"]]);
    if (checks.length === 1) throw new Error("社員・車両番号の形式制約が途中の状態です");
    if (checks.length === 2) alreadyApplied.push("20261027100000_fix_record_code_format");
    // No migration is marked until the entire existing shape passed preflight.
    for (const name of alreadyApplied.sort()) {
      console.log(`Registering verified existing schema: ${name}.`);
      execFileSync("npx", ["prisma", "migrate", "resolve", "--applied", name], { stdio: "inherit" });
    }
  }
}
finally {
  await client.end();
}
