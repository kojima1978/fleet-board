import assert from "node:assert/strict";
import pg from "pg";

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL;
const appUrl = process.env.APP_URL || "http://127.0.0.1:3000";
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const client = new Client({ connectionString: databaseUrl });
const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const ids = { department: `test-dept-${suffix}`, employeeNumber: `test-en-${suffix}`, employee: `test-employee-${suffix}`, vehicleNumber: `test-vn-${suffix}`, vehicle: `test-vehicle-${suffix}`, spot: `test-spot-${suffix}` };
const operationIds = [];

async function post(body) {
  const response = await fetch(`${appUrl}/api/dashboard`, { method: "POST", headers: { "Content-Type": "application/json", Origin: new URL(appUrl).origin }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

async function authenticateAdmin() {
  const pin = process.env.FLEETFLOW_ADMIN_PIN;
  if (!pin) throw new Error("FLEETFLOW_ADMIN_PIN is required for maintenance integration test");
  const response = await fetch(`${appUrl}/api/admin/session`, { method: "POST", headers: { "Content-Type": "application/json", Origin: new URL(appUrl).origin }, body: JSON.stringify({ pin }) });
  assert.equal(response.status, 200, await response.text());
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!cookie) throw new Error("Admin session cookie was not returned");
  return cookie;
}

async function postAdmin(body, cookie) {
  const response = await fetch(`${appUrl}/api/dashboard`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie, Origin: new URL(appUrl).origin }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

async function cleanup() {
  if (operationIds.length) await client.query('DELETE FROM "AuditLog" WHERE "operationId" = ANY($1)', [operationIds]);
  await client.query('DELETE FROM "Trip" WHERE "employeeId" = $1 OR "vehicleId" = $2', [ids.employee, ids.vehicle]);
  await client.query('DELETE FROM "Vehicle" WHERE id = $1', [ids.vehicle]);
  await client.query('DELETE FROM "Employee" WHERE id = $1', [ids.employee]);
  await client.query('DELETE FROM "ParkingSpot" WHERE id = $1', [ids.spot]);
  await client.query('DELETE FROM "VehicleNumber" WHERE id = $1', [ids.vehicleNumber]);
  await client.query('DELETE FROM "EmployeeNumber" WHERE id = $1', [ids.employeeNumber]);
  await client.query('DELETE FROM "Department" WHERE id = $1', [ids.department]);
}

await client.connect();
try {
  const now = new Date();
  await client.query('INSERT INTO "Department" (id,name,active,"createdAt","updatedAt") VALUES ($1,$2,true,$3,$3)', [ids.department, `APIテスト${suffix}`, now]);
  await client.query('INSERT INTO "EmployeeNumber" (id,code,"createdAt","updatedAt") VALUES ($1,$2,$3,$3)', [ids.employeeNumber, `TE${suffix}`, now]);
  await client.query('INSERT INTO "Employee" (id,"employeeNumberId","departmentId",name,active,version,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,true,1,$5,$5)', [ids.employee, ids.employeeNumber, ids.department, `テスト社員${suffix}`, now]);
  await client.query('INSERT INTO "VehicleNumber" (id,code,"createdAt","updatedAt") VALUES ($1,$2,$3,$3)', [ids.vehicleNumber, `TV${suffix}`, now]);
  await client.query('INSERT INTO "Vehicle" (id,"vehicleNumberId",name,"plateNumber",color,"fuelLevel",active,status,version,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,3,true,\'AVAILABLE\',1,$6,$6)', [ids.vehicle, ids.vehicleNumber, `テスト車両${suffix}`, `TEST-${suffix}`, "#2563eb", now]);
  await client.query('INSERT INTO "ParkingSpot" (id,code,x,y,width,height,orientation,enabled,version) VALUES ($1,$2,0,0,5,5,\'horizontal\',true,1)', [ids.spot, `T${suffix}`]);

  const startOperationId = crypto.randomUUID(); operationIds.push(startOperationId);
  const startBody = { operationId: startOperationId, action: "start", employeeId: ids.employee, vehicleId: ids.vehicle, minutes: 60, actorName: "自動テスト", actorEmployeeId: ids.employee };
  const [firstStart, replayedStart] = await Promise.all([post(startBody), post(startBody)]);
  assert.equal(firstStart.status, 200, JSON.stringify(firstStart.body));
  assert.equal(replayedStart.status, 200, JSON.stringify(replayedStart.body));
  const started = await client.query('SELECT id,version FROM "Trip" WHERE "vehicleId"=$1 AND status=\'IN_USE\'', [ids.vehicle]);
  assert.equal(started.rowCount, 1, "同一操作の同時送信でTripが重複しています");
  const startLogs = await client.query('SELECT id,"actorName","actorEmployeeId" FROM "AuditLog" WHERE "operationId"=$1', [startOperationId]);
  assert.equal(startLogs.rowCount, 1, "同一操作の監査ログが重複しています");
  assert.equal(startLogs.rows[0].actorName, `テスト社員${suffix}`, "監査ログの利用者名がサーバー側の社員情報と一致しません");
  assert.equal(startLogs.rows[0].actorEmployeeId, ids.employee, "監査ログの社員IDが一致しません");

  const vehicle = await client.query('SELECT version FROM "Vehicle" WHERE id=$1', [ids.vehicle]);
  const endOperationId = crypto.randomUUID(); operationIds.push(endOperationId);
  const endBody = { operationId: endOperationId, action: "end", tripId: started.rows[0].id, tripVersion: started.rows[0].version, vehicleId: ids.vehicle, vehicleVersion: vehicle.rows[0].version, spotId: ids.spot, fuelLevel: 1, actorName: "自動テスト", actorEmployeeId: ids.employee };
  const ended = await post(endBody);
  const replayedEnd = await post(endBody);
  assert.equal(ended.status, 200, JSON.stringify(ended.body));
  assert.equal(replayedEnd.status, 200, JSON.stringify(replayedEnd.body));
  assert.equal(replayedEnd.body.replayed, true, "返却の再送がreplayedとして処理されていません");
  const completed = await client.query('SELECT status,"returnFuelLevel","previousFuelLevel" FROM "Trip" WHERE id=$1', [started.rows[0].id]);
  assert.equal(completed.rows[0].status, "COMPLETED");
  assert.equal(completed.rows[0].returnFuelLevel, 1, "返却時の残量が記録されていません");
  assert.equal(completed.rows[0].previousFuelLevel, 3, "返却前の残量が記録されていません");
  const fueledVehicle = await client.query('SELECT "fuelLevel" FROM "Vehicle" WHERE id=$1', [ids.vehicle]);
  assert.equal(fueledVehicle.rows[0].fuelLevel, 1, "車両の残量が更新されていません");
  const endLog = await client.query('SELECT description FROM "AuditLog" WHERE "operationId"=$1', [endOperationId]);
  assert.match(endLog.rows[0].description, /残量 1\/4/, "操作履歴に残量が記録されていません");

  const undoOperationId = crypto.randomUUID(); operationIds.push(undoOperationId);
  const undone = await post({ operationId: undoOperationId, action: "undoReturn", tripId: started.rows[0].id, vehicleId: ids.vehicle, actorName: "自動テスト", actorEmployeeId: ids.employee });
  assert.equal(undone.status, 200, JSON.stringify(undone.body));
  const restoredVehicle = await client.query('SELECT "fuelLevel",version FROM "Vehicle" WHERE id=$1', [ids.vehicle]);
  assert.equal(restoredVehicle.rows[0].fuelLevel, 3, "返却取消で残量が元に戻っていません");
  const restoredTrip = await client.query('SELECT status,version,"returnFuelLevel" FROM "Trip" WHERE id=$1', [started.rows[0].id]);
  assert.equal(restoredTrip.rows[0].status, "IN_USE");
  assert.equal(restoredTrip.rows[0].returnFuelLevel, null);
  const unfueledEndOperationId = crypto.randomUUID(); operationIds.push(unfueledEndOperationId);
  const unfueledEnd = await post({ operationId: unfueledEndOperationId, action: "end", tripId: started.rows[0].id, tripVersion: restoredTrip.rows[0].version, vehicleId: ids.vehicle, vehicleVersion: restoredVehicle.rows[0].version, spotId: ids.spot, actorName: "自動テスト", actorEmployeeId: ids.employee });
  assert.equal(unfueledEnd.status, 200, JSON.stringify(unfueledEnd.body));
  const keptFuel = await client.query('SELECT "fuelLevel" FROM "Vehicle" WHERE id=$1', [ids.vehicle]);
  assert.equal(keptFuel.rows[0].fuelLevel, 3, "残量未選択の返却で残量が変わりました");
  const parkedVehicle = await client.query('SELECT version FROM "Vehicle" WHERE id=$1', [ids.vehicle]);
  const fuelFixOperationId = crypto.randomUUID(); operationIds.push(fuelFixOperationId);
  const fuelFixed = await post({ operationId: fuelFixOperationId, action: "setFuelLevel", vehicleId: ids.vehicle, version: parkedVehicle.rows[0].version, fuelLevel: 2, actorName: "自動テスト" });
  assert.equal(fuelFixed.status, 200, JSON.stringify(fuelFixed.body));
  const fixedVehicle = await client.query('SELECT "fuelLevel",version FROM "Vehicle" WHERE id=$1', [ids.vehicle]);
  assert.equal(fixedVehicle.rows[0].fuelLevel, 2, "駐車後の残量修正が反映されていません");
  const fuelFixAudit = await client.query('SELECT action,description FROM "AuditLog" WHERE "operationId"=$1', [fuelFixOperationId]);
  assert.equal(fuelFixAudit.rows[0]?.action, "残量修正");
  assert.match(fuelFixAudit.rows[0]?.description ?? "", /3\/4から1\/2へ修正/);
  const staleFuelOperationId = crypto.randomUUID(); operationIds.push(staleFuelOperationId);
  const staleFuel = await post({ operationId: staleFuelOperationId, action: "setFuelLevel", vehicleId: ids.vehicle, version: parkedVehicle.rows[0].version, fuelLevel: 4, actorName: "自動テスト" });
  assert.notEqual(staleFuel.status, 200, "古い版での残量修正が通りました");
  const sameFuelOperationId = crypto.randomUUID(); operationIds.push(sameFuelOperationId);
  const sameFuel = await post({ operationId: sameFuelOperationId, action: "setFuelLevel", vehicleId: ids.vehicle, version: fixedVehicle.rows[0].version, fuelLevel: 2, actorName: "自動テスト" });
  assert.notEqual(sameFuel.status, 200, "同じ残量への修正が通りました");

  const reserveOperationId = crypto.randomUUID(); operationIds.push(reserveOperationId);
  const plannedStart = new Date(Date.now() + 2 * 60 * 60_000);
  const reserved = await post({ operationId: reserveOperationId, action: "reserve", employeeId: ids.employee, vehicleId: ids.vehicle, plannedStart: plannedStart.toISOString(), minutes: 60, actorName: "自動テスト", actorEmployeeId: ids.employee });
  assert.equal(reserved.status, 200, JSON.stringify(reserved.body));
  const reservation = await client.query('SELECT id,version,"plannedEnd" FROM "Trip" WHERE "vehicleId"=$1 AND status=\'RESERVED\'', [ids.vehicle]);
  assert.equal(reservation.rowCount, 1);
  const editOperationId = crypto.randomUUID(); operationIds.push(editOperationId);
  const changedEnd = new Date(new Date(reservation.rows[0].plannedEnd).getTime() + 3 * 60 * 60_000);
  const edited = await post({ operationId: editOperationId, action: "setTripEnd", tripId: reservation.rows[0].id, version: reservation.rows[0].version, plannedEnd: changedEnd.toISOString(), actorName: "自動テスト", actorEmployeeId: ids.employee });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  const editedReservation = await client.query('SELECT version,"plannedEnd" FROM "Trip" WHERE id=$1', [reservation.rows[0].id]);
  assert.equal(new Date(editedReservation.rows[0].plannedEnd).getTime(), changedEnd.getTime());
  const cancelOperationId = crypto.randomUUID(); operationIds.push(cancelOperationId);
  const cancelled = await post({ operationId: cancelOperationId, action: "cancelTrip", tripId: reservation.rows[0].id, version: editedReservation.rows[0].version, actorName: "自動テスト", actorEmployeeId: ids.employee });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  const cancelledReservation = await client.query('SELECT status FROM "Trip" WHERE id=$1', [reservation.rows[0].id]);
  assert.equal(cancelledReservation.rows[0].status, "CANCELLED");

  const adminCookie = await authenticateAdmin();
  const unauthenticatedOperations = await fetch(`${appUrl}/api/operations`);
  assert.equal(unauthenticatedOperations.status, 401, "未認証で操作履歴を取得できてしまいます");
  const authenticatedOperations = await fetch(`${appUrl}/api/operations`, { headers: { Cookie: adminCookie } });
  assert.equal(authenticatedOperations.status, 200, await authenticatedOperations.text());
  const beforeMaintenance = await client.query('SELECT version FROM "Vehicle" WHERE id=$1', [ids.vehicle]);
  const maintenanceOperationId = crypto.randomUUID(); operationIds.push(maintenanceOperationId);
  const maintenance = await postAdmin({ operationId: maintenanceOperationId, action: "setVehicleMaintenance", id: ids.vehicle, version: beforeMaintenance.rows[0].version, maintenance: true }, adminCookie);
  assert.equal(maintenance.status, 200, JSON.stringify(maintenance.body));
  const maintainedVehicle = await client.query('SELECT status,version FROM "Vehicle" WHERE id=$1', [ids.vehicle]);
  assert.equal(maintainedVehicle.rows[0].status, "MAINTENANCE");
  const blockedStartOperationId = crypto.randomUUID(); operationIds.push(blockedStartOperationId);
  const blockedStart = await post({ operationId: blockedStartOperationId, action: "start", employeeId: ids.employee, vehicleId: ids.vehicle, minutes: 60, actorName: "自動テスト", actorEmployeeId: ids.employee });
  assert.equal(blockedStart.status, 400, "整備中の車両で利用開始できてしまいました");
  const releaseOperationId = crypto.randomUUID(); operationIds.push(releaseOperationId);
  const released = await postAdmin({ operationId: releaseOperationId, action: "setVehicleMaintenance", id: ids.vehicle, version: maintainedVehicle.rows[0].version, maintenance: false }, adminCookie);
  assert.equal(released.status, 200, JSON.stringify(released.body));
  const releasedVehicle = await client.query('SELECT status FROM "Vehicle" WHERE id=$1', [ids.vehicle]);
  assert.equal(releasedVehicle.rows[0].status, "AVAILABLE");
  console.log("API integration passed: start, duplicate suppression, return replay, fuel level, undo, reservation, edit, cancellation and maintenance safety");
} finally {
  await cleanup().catch((error) => console.error("cleanup failed", error));
  await client.end();
}
