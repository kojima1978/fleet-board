import assert from "node:assert/strict";
import pg from "pg";

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL;
const appUrl = process.env.APP_URL || "http://127.0.0.1:3000";
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const suffix = String(Date.now()).slice(-9);
const names = { first: `部署試験A${suffix}`, second: `部署試験B${suffix}`, renamed: `部署試験C${suffix}`, unknown: `未登録部署${suffix}` };
const employeeCode = `DEP${suffix}`;
const employeeUid = `D0A0${suffix}00`;
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

const findDepartment = (data, name) => data.departments.find((item) => item.name === name);
const activeNames = (data) => data.departments.filter((item) => item.active).map((item) => item.name);

async function cleanup() {
  const employees = await client.query('SELECT e.id FROM "Employee" e JOIN "EmployeeNumber" n ON n.id=e."employeeNumberId" WHERE n.code=$1', [employeeCode]);
  const employeeIds = employees.rows.map((row) => row.id);
  await client.query("BEGIN");
  try {
    await client.query('DELETE FROM "AuditLog" WHERE "operationId" = ANY($1::text[])', [operationIds]);
    await client.query('DELETE FROM "NfcAssignment" WHERE "employeeId" = ANY($1::text[])', [employeeIds]);
    await client.query('DELETE FROM "Employee" WHERE id = ANY($1::text[])', [employeeIds]);
    await client.query('DELETE FROM "EmployeeNumber" WHERE code=$1', [employeeCode]);
    await client.query('DELETE FROM "NfcTag" WHERE uid=$1 AND NOT EXISTS (SELECT 1 FROM "NfcAssignment" WHERE "nfcTagId"="NfcTag".id)', [employeeUid]);
    await client.query('DELETE FROM "Department" WHERE name = ANY($1::text[]) AND NOT EXISTS (SELECT 1 FROM "Employee" WHERE "departmentId"="Department".id)', [Object.values(names)]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

await client.connect();
try {
  // 追加した部署は末尾に並び、同じ名前は空白の違いがあっても登録できない。
  await postAdmin({ action: "createDepartment", name: names.first });
  await postAdmin({ action: "createDepartment", name: `  ${names.second} ` });
  let rejected = await postAdmin({ action: "createDepartment", name: names.first }, 400);
  assert.match(rejected.message, /すでに登録/);
  let data = await dashboard();
  assert.deepEqual(activeNames(data).slice(-2), [names.first, names.second]);
  assert.equal(findDepartment(data, names.first).employeeCount, 0);

  // 上下ボタンで隣と入れ替わり、端ではそれ以上動かない。
  await postAdmin({ action: "moveDepartment", id: findDepartment(data, names.second).id, direction: "up" });
  data = await dashboard();
  assert.deepEqual(activeNames(data).slice(-2), [names.second, names.first]);
  rejected = await postAdmin({ action: "moveDepartment", id: findDepartment(data, names.first).id, direction: "down" }, 400);
  assert.match(rejected.message, /末尾/);
  rejected = await postAdmin({ action: "moveDepartment", id: findDepartment(data, activeNames(data)[0]).id, direction: "up" }, 400);
  assert.match(rejected.message, /先頭/);

  // 社員の部署は登録済みの部署から選ぶ。未登録の部署名では登録できない。
  rejected = await postAdmin({ action: "createEmployee", code: employeeCode, name: "部署試験社員", department: names.unknown, nfcUid: employeeUid }, 400);
  assert.match(rejected.message, /登録されていません/);
  assert.equal(findDepartment(await dashboard(), names.unknown), undefined);
  await postAdmin({ action: "createEmployee", code: employeeCode, name: "部署試験社員", department: names.first, nfcUid: employeeUid });
  data = await dashboard();
  assert.equal(findDepartment(data, names.first).employeeCount, 1);

  // 有効な社員が所属する部署は停止できない。
  let first = findDepartment(data, names.first);
  rejected = await postAdmin({ action: "setDepartmentActive", id: first.id, version: first.version, active: false }, 400);
  assert.match(rejected.message, /1人所属/);

  // 名前を変えると所属社員の表示も変わる。古いversionでは変更できない。
  await postAdmin({ action: "renameDepartment", id: first.id, version: first.version, name: names.renamed });
  rejected = await postAdmin({ action: "renameDepartment", id: first.id, version: first.version, name: names.first }, 409);
  data = await dashboard();
  assert.equal(data.employees.find((item) => item.code === employeeCode)?.department, names.renamed);
  rejected = await postAdmin({ action: "renameDepartment", id: findDepartment(data, names.renamed).id, version: findDepartment(data, names.renamed).version, name: names.second }, 400);
  assert.match(rejected.message, /すでに登録/);

  // 所属社員のいない部署は停止でき、停止中は社員の部署にも並べ替えにも使えない。
  let second = findDepartment(data, names.second);
  await postAdmin({ action: "setDepartmentActive", id: second.id, version: second.version, active: false });
  data = await dashboard();
  second = findDepartment(data, names.second);
  assert.equal(second.active, false);
  const person = data.employees.find((item) => item.code === employeeCode);
  rejected = await postAdmin({ action: "updateEmployee", id: person.id, version: person.version, name: person.name, department: names.second, nfcUid: person.nfcUid }, 400);
  assert.match(rejected.message, /利用停止中/);
  rejected = await postAdmin({ action: "createDepartment", name: names.second }, 400);
  assert.match(rejected.message, /利用停止中/);
  rejected = await postAdmin({ action: "moveDepartment", id: second.id, direction: "up" }, 400);
  assert.match(rejected.message, /並べ替えできません/);

  // 再開した部署は末尾に戻り、また選べる。
  await postAdmin({ action: "setDepartmentActive", id: second.id, version: second.version, active: true });
  data = await dashboard();
  assert.equal(activeNames(data).at(-1), names.second);
  await postAdmin({ action: "updateEmployee", id: person.id, version: person.version, name: person.name, department: names.second, nfcUid: person.nfcUid });
  data = await dashboard();
  assert.equal(data.employees.find((item) => item.code === employeeCode)?.department, names.second);
  assert.equal(findDepartment(data, names.second).employeeCount, 1);
  assert.equal(findDepartment(data, names.renamed).employeeCount, 0);
  console.log("Department management passed: create, reorder, rename, stop and resume departments, and employees only use registered active departments");
} finally {
  await cleanup().catch((error) => console.error("cleanup failed", error));
  await client.end();
}
