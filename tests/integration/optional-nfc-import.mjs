import assert from "node:assert/strict";
import pg from "pg";
import { freeRecordCodes } from "./record-codes.mjs";

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL;
const appUrl = process.env.APP_URL || "http://127.0.0.1:3000";
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const suffix = String(Date.now()).slice(-9);
let employeeCodes = [];
let vehicleCodes = [];
const departmentName = `取込テスト${suffix}`;
const plateNumbers = [`TEST-A-${suffix}`, `TEST-B-${suffix}`];
const employeeUids = [`E0A0${suffix}00`, `E0B0${suffix}00`, `E0C0${suffix}00`];
const vehicleUids = [`C0A0${suffix}00`, `C0B0${suffix}00`];
const operationIds = [];
const client = new Client({ connectionString: databaseUrl });

async function postAdmin(body, expectedStatus = 200) {
  const operationId = crypto.randomUUID();
  operationIds.push(operationId);
  const response = await fetch(`${appUrl}/api/dashboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operationId, ...body }),
  });
  const responseBody = await response.json();
  assert.equal(response.status, expectedStatus, JSON.stringify(responseBody));
  return responseBody;
}

async function dashboard() {
  const response = await fetch(`${appUrl}/api/dashboard`);
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
  employeeCodes = await freeRecordCodes(client, "EmployeeNumber", "X", 5);
  vehicleCodes = await freeRecordCodes(client, "VehicleNumber", "X", 3);
  // JSON取込も英字1文字＋数字3桁に固定し、1件でも誤りがあれば全件を登録しない。
  const invalidImport = await postAdmin({ action: "importVehicles", items: [{ code: vehicleCodes[0], name: "形式確認車両", plateNumber: plateNumbers[0], color: "#2563EB" }, { code: "XY12", name: "形式誤り車両", plateNumber: plateNumbers[1], color: "#0891B2" }] }, 400);
  assert.match(invalidImport.message, /2件目の車両番号は英字1文字と数字3桁/);
  await postAdmin({
    action: "importEmployees",
    items: [
      { code: employeeCodes[0], name: "NFC後登録社員", department: departmentName },
      { code: employeeCodes[1], name: "NFC同時登録社員", department: departmentName, nfcUid: employeeUids[1] },
      { code: employeeCodes[3], name: "NFCなし社員", department: departmentName },
    ],
  });
  await postAdmin({
    action: "importVehicles",
    items: [
      { code: vehicleCodes[0], name: "NFC後登録車両", plateNumber: plateNumbers[0], color: "#2563EB", hasEtc: true, hasNavigation: true },
      { code: vehicleCodes[1], name: "NFC同時登録車両", plateNumber: plateNumbers[1], nfcUid: vehicleUids[1], color: "#0891B2" },
    ],
  });


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

  // NFCなしで取り込んだ社員も、カードを登録しないまま編集して保存できる。
  await postAdmin({ action: "updateEmployee", id: employeeWithoutNfc.id, version: employeeWithoutNfc.version, name: `${employeeWithoutNfc.name}改`, department: employeeWithoutNfc.department, nfcUid: "" });
  data = await dashboard();
  const editedWithoutNfc = data.employees.find((item) => item.id === employeeWithoutNfc.id);
  assert.equal(editedWithoutNfc?.name, `${employeeWithoutNfc.name}改`);
  assert.equal(editedWithoutNfc?.nfcUid, "");
  Object.assign(employeeWithoutNfc, editedWithoutNfc);

  await postAdmin({ action: "updateEmployee", id: employeeWithoutNfc.id, version: employeeWithoutNfc.version, name: employeeWithoutNfc.name, department: employeeWithoutNfc.department, nfcUid: employeeUids[0] });
  await postAdmin({ action: "updateVehicle", id: vehicleWithoutNfc.id, version: vehicleWithoutNfc.version, name: vehicleWithoutNfc.name, plateNumber: vehicleWithoutNfc.plateNumber, nfcUid: vehicleUids[0], color: vehicleWithoutNfc.color });

  data = await dashboard();
  assert.equal(data.employees.find((item) => item.code === employeeCodes[0])?.nfcUid, employeeUids[0]);
  assert.equal(data.vehicles.find((item) => item.code === vehicleCodes[0])?.nfcUid, vehicleUids[0]);
  assert.equal(data.vehicles.find((item) => item.code === vehicleCodes[0])?.hasEtc, true);
  assert.equal(data.vehicles.find((item) => item.code === vehicleCodes[0])?.hasNavigation, true);

  // 社員番号を変更でき、有効な他の社員と同じ番号には変更できない。
  const renamed = data.employees.find((item) => item.code === employeeCodes[0]);
  await postAdmin({ action: "updateEmployee", id: renamed.id, version: renamed.version, code: employeeCodes[2], name: renamed.name, department: renamed.department, nfcUid: renamed.nfcUid });
  data = await dashboard();
  assert.equal(data.employees.find((item) => item.id === renamed.id)?.code, employeeCodes[2]);
  // 付け替え前の番号は、ほかに使う社員がいないため残らない。
  assert.equal((await client.query('SELECT 1 FROM "EmployeeNumber" WHERE code=$1', [employeeCodes[0]])).rowCount, 0);
  const other = data.employees.find((item) => item.code === employeeCodes[1]);
  const rejected = await postAdmin({ action: "updateEmployee", id: other.id, version: other.version, code: employeeCodes[2], name: other.name, department: other.department, nfcUid: other.nfcUid }, 400);
  assert.match(rejected.message, /使用中/);
  data = await dashboard();
  assert.equal(data.employees.find((item) => item.id === other.id)?.code, employeeCodes[1]);

  // 車両番号も変更でき、有効な他の車両と同じ番号には変更できない。
  const renamedVehicle = data.vehicles.find((item) => item.code === vehicleCodes[0]);
  await postAdmin({ action: "updateVehicle", id: renamedVehicle.id, version: renamedVehicle.version, code: vehicleCodes[2], name: renamedVehicle.name, plateNumber: renamedVehicle.plateNumber, nfcUid: renamedVehicle.nfcUid, color: renamedVehicle.color });
  data = await dashboard();
  assert.equal(data.vehicles.find((item) => item.id === renamedVehicle.id)?.code, vehicleCodes[2]);
  assert.equal((await client.query('SELECT 1 FROM "VehicleNumber" WHERE code=$1', [vehicleCodes[0]])).rowCount, 0);
  const otherVehicle = data.vehicles.find((item) => item.code === vehicleCodes[1]);
  const rejectedVehicle = await postAdmin({ action: "updateVehicle", id: otherVehicle.id, version: otherVehicle.version, code: vehicleCodes[2], name: otherVehicle.name, plateNumber: otherVehicle.plateNumber, nfcUid: otherVehicle.nfcUid, color: otherVehicle.color }, 400);
  assert.match(rejectedVehicle.message, /使用中/);
  data = await dashboard();
  assert.equal(data.vehicles.find((item) => item.id === otherVehicle.id)?.code, vehicleCodes[1]);
  // 車両もUIDを消して保存すると、タグの割り当てを外す。
  const clearedVehicle = data.vehicles.find((item) => item.id === otherVehicle.id);
  await postAdmin({ action: "updateVehicle", id: clearedVehicle.id, version: clearedVehicle.version, name: clearedVehicle.name, plateNumber: clearedVehicle.plateNumber, nfcUid: "", color: clearedVehicle.color });
  data = await dashboard();
  assert.equal(data.vehicles.find((item) => item.id === clearedVehicle.id)?.nfcUid, "");
  assert.equal((await client.query('SELECT 1 FROM "NfcAssignment" WHERE "vehicleId"=$1 AND "validTo" IS NULL', [clearedVehicle.id])).rowCount, 0);

  // 設定画面からもNFCなしで社員を登録でき、あとから付けたカードを外せる。
  await postAdmin({ action: "createEmployee", code: employeeCodes[4], name: "NFCなし新規社員", department: departmentName, nfcUid: "" });
  data = await dashboard();
  let created = data.employees.find((item) => item.code === employeeCodes[4]);
  assert.equal(created?.nfcUid, "");
  await postAdmin({ action: "updateEmployee", id: created.id, version: created.version, name: created.name, department: created.department, nfcUid: employeeUids[2] });
  data = await dashboard();
  created = data.employees.find((item) => item.id === created.id);
  assert.equal(created.nfcUid, employeeUids[2]);
  await postAdmin({ action: "updateEmployee", id: created.id, version: created.version, name: created.name, department: created.department, nfcUid: "" });
  data = await dashboard();
  assert.equal(data.employees.find((item) => item.id === created.id)?.nfcUid, "");
  assert.equal((await client.query('SELECT 1 FROM "NfcAssignment" WHERE "employeeId"=$1 AND "validTo" IS NULL', [created.id])).rowCount, 0);
  // 外したカードは、利用停止から再開しても戻らない。
  created = data.employees.find((item) => item.id === created.id);
  await postAdmin({ action: "setEmployeeActive", id: created.id, version: created.version, active: false });
  data = await dashboard();
  created = data.employees.find((item) => item.id === created.id);
  assert.equal(created.nfcUid, "");
  await postAdmin({ action: "setEmployeeActive", id: created.id, version: created.version, active: true });
  data = await dashboard();
  assert.equal(data.employees.find((item) => item.id === created.id)?.nfcUid, "");
  assert.equal((await client.query('SELECT 1 FROM "NfcAssignment" WHERE "employeeId"=$1 AND "validTo" IS NULL', [created.id])).rowCount, 0);

  // 利用停止でカードの割り当てを外し、再開で以前のカードを戻す。カードのない社員も再開できる。
  for (const code of [employeeCodes[1], employeeCodes[3]]) {
    let person = data.employees.find((item) => item.code === code);
    const previousUid = person.nfcUid;
    await postAdmin({ action: "setEmployeeActive", id: person.id, version: person.version, active: false });
    data = await dashboard();
    person = data.employees.find((item) => item.id === person.id);
    assert.equal(person.active, false);
    const openAssignments = await client.query('SELECT 1 FROM "NfcAssignment" WHERE "employeeId"=$1 AND "validTo" IS NULL', [person.id]);
    assert.equal(openAssignments.rowCount, 0);
    await postAdmin({ action: "setEmployeeActive", id: person.id, version: person.version, active: true });
    data = await dashboard();
    person = data.employees.find((item) => item.id === person.id);
    assert.equal(person.active, true);
    assert.equal(person.nfcUid, previousUid);
  }
  console.log("Optional NFC and vehicle equipment import passed: equipment survives later NFC registration, employees can be registered and edited without NFC, employee and vehicle numbers can be changed, employees can be stopped and resumed with or without NFC");
} finally {
  await cleanup().catch((error) => console.error("cleanup failed", error));
  await client.end();
}
