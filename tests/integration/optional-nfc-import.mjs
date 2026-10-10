import assert from "node:assert/strict";
import pg from "pg";

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL;
const adminPin = process.env.FLEETFLOW_ADMIN_PIN;
const appUrl = process.env.APP_URL || "http://127.0.0.1:3000";
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!adminPin) throw new Error("FLEETFLOW_ADMIN_PIN is required");

const suffix = String(Date.now()).slice(-9);
const employeeCodes = [`IEA${suffix}`, `IEB${suffix}`];
const vehicleCodes = [`IVA${suffix}`, `IVB${suffix}`];
const departmentName = `取込テスト${suffix}`;
const plateNumbers = [`TEST-A-${suffix}`, `TEST-B-${suffix}`];
const employeeUids = [`E0A0${suffix}00`, `E0B0${suffix}00`];
const vehicleUids = [`C0A0${suffix}00`, `C0B0${suffix}00`];
const operationIds = [];
const client = new Client({ connectionString: databaseUrl });
let cookie = "";

async function postAdmin(body) {
  const operationId = crypto.randomUUID();
  operationIds.push(operationId);
  const response = await fetch(`${appUrl}/api/dashboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ operationId, ...body }),
  });
  const responseBody = await response.json();
  assert.equal(response.status, 200, JSON.stringify(responseBody));
}

async function dashboard(authenticated = true) {
  const response = await fetch(`${appUrl}/api/dashboard`, { headers: authenticated ? { Cookie: cookie } : undefined });
  assert.equal(response.status, 200);
  return response.json();
}

async function cleanup() {
  const employees = await client.query('SELECT e.id FROM "Employee" e JOIN "EmployeeNumber" n ON n.id=e."employeeNumberId" WHERE n.code = ANY($1::text[])', [employeeCodes]);
  const vehicles = await client.query('SELECT v.id FROM "Vehicle" v JOIN "VehicleNumber" n ON n.id=v."vehicleNumberId" WHERE n.code = ANY($1::text[])', [vehicleCodes]);
  const employeeIds = employees.rows.map((row) => row.id);
  const vehicleIds = vehicles.rows.map((row) => row.id);
  await client.query("BEGIN");
  try {
    await client.query('DELETE FROM "AuditLog" WHERE "operationId" = ANY($1::text[])', [operationIds]);
    await client.query('DELETE FROM "NfcAssignment" WHERE "employeeId" = ANY($1::text[]) OR "vehicleId" = ANY($2::text[])', [employeeIds, vehicleIds]);
    await client.query('DELETE FROM "Employee" WHERE id = ANY($1::text[])', [employeeIds]);
    await client.query('DELETE FROM "Vehicle" WHERE id = ANY($1::text[])', [vehicleIds]);
    await client.query('DELETE FROM "EmployeeNumber" WHERE code = ANY($1::text[])', [employeeCodes]);
    await client.query('DELETE FROM "VehicleNumber" WHERE code = ANY($1::text[])', [vehicleCodes]);
    await client.query('DELETE FROM "Department" WHERE name=$1 AND NOT EXISTS (SELECT 1 FROM "Employee" WHERE "departmentId"="Department".id)', [departmentName]);
    await client.query('DELETE FROM "NfcTag" WHERE uid = ANY($1::text[]) AND NOT EXISTS (SELECT 1 FROM "NfcAssignment" WHERE "nfcTagId"="NfcTag".id)', [[...employeeUids, ...vehicleUids]]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

await client.connect();
try {
  const login = await fetch(`${appUrl}/api/admin/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: adminPin }),
  });
  assert.equal(login.status, 200, await login.text());
  cookie = login.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
  assert.ok(cookie, "管理者セッションCookieを取得できません");

  await postAdmin({
    action: "importEmployees",
    items: [
      { code: employeeCodes[0], name: "NFC後登録社員", department: departmentName },
      { code: employeeCodes[1], name: "NFC同時登録社員", department: departmentName, nfcUid: employeeUids[1] },
    ],
  });
  await postAdmin({
    action: "importVehicles",
    items: [
      { code: vehicleCodes[0], name: "NFC後登録車両", plateNumber: plateNumbers[0], color: "#2563EB", hasEtc: true, hasNavigation: true },
      { code: vehicleCodes[1], name: "NFC同時登録車両", plateNumber: plateNumbers[1], nfcUid: vehicleUids[1], color: "#0891B2" },
    ],
  });

  const publicData = await dashboard(false);
  assert.equal(publicData.employees.find((item) => item.code === employeeCodes[1])?.nfcUid, "", "未認証の一覧に社員NFC UIDを含めない");
  assert.equal(publicData.vehicles.find((item) => item.code === vehicleCodes[1])?.nfcUid, "", "未認証の一覧に車両NFC UIDを含めない");

  let data = await dashboard();
  const employeeWithoutNfc = data.employees.find((item) => item.code === employeeCodes[0]);
  const employeeWithNfc = data.employees.find((item) => item.code === employeeCodes[1]);
  const vehicleWithoutNfc = data.vehicles.find((item) => item.code === vehicleCodes[0]);
  const vehicleWithNfc = data.vehicles.find((item) => item.code === vehicleCodes[1]);
  assert.equal(employeeWithoutNfc?.nfcUid, "");
  assert.equal(employeeWithNfc?.nfcUid, employeeUids[1]);
  assert.equal(vehicleWithoutNfc?.nfcUid, "");
  assert.equal(vehicleWithNfc?.nfcUid, vehicleUids[1]);
  assert.equal(vehicleWithoutNfc?.hasEtc, true);
  assert.equal(vehicleWithoutNfc?.hasNavigation, true);
  assert.equal(vehicleWithNfc?.hasEtc, false);
  assert.equal(vehicleWithNfc?.hasNavigation, false);

  await postAdmin({ action: "updateEmployee", id: employeeWithoutNfc.id, version: employeeWithoutNfc.version, name: employeeWithoutNfc.name, department: employeeWithoutNfc.department, nfcUid: employeeUids[0] });
  await postAdmin({ action: "updateVehicle", id: vehicleWithoutNfc.id, version: vehicleWithoutNfc.version, name: vehicleWithoutNfc.name, plateNumber: vehicleWithoutNfc.plateNumber, nfcUid: vehicleUids[0], color: vehicleWithoutNfc.color });

  data = await dashboard();
  assert.equal(data.employees.find((item) => item.code === employeeCodes[0])?.nfcUid, employeeUids[0]);
  assert.equal(data.vehicles.find((item) => item.code === vehicleCodes[0])?.nfcUid, vehicleUids[0]);
  assert.equal(data.vehicles.find((item) => item.code === vehicleCodes[0])?.hasEtc, true);
  assert.equal(data.vehicles.find((item) => item.code === vehicleCodes[0])?.hasNavigation, true);
  console.log("Optional NFC and vehicle equipment import passed: equipment survives later NFC registration");
} finally {
  await cleanup().catch((error) => console.error("cleanup failed", error));
  await client.end();
}
