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
  const response = await fetch(`${appUrl}/api/dashboard`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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
  await client.query('INSERT INTO "Vehicle" (id,"vehicleNumberId",name,"plateNumber",color,active,status,version,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,true,\'AVAILABLE\',1,$6,$6)', [ids.vehicle, ids.vehicleNumber, `テスト車両${suffix}`, `TEST-${suffix}`, "#2563eb", now]);
  await client.query('INSERT INTO "ParkingSpot" (id,code,x,y,width,height,orientation,enabled,version) VALUES ($1,$2,0,0,5,5,\'horizontal\',true,1)', [ids.spot, `T${suffix}`]);

  const startOperationId = crypto.randomUUID(); operationIds.push(startOperationId);
  const startBody = { operationId: startOperationId, action: "start", employeeId: ids.employee, vehicleId: ids.vehicle, minutes: 60, actorName: "自動テスト", actorEmployeeId: ids.employee };
  const [firstStart, replayedStart] = await Promise.all([post(startBody), post(startBody)]);
  assert.equal(firstStart.status, 200, JSON.stringify(firstStart.body));
  assert.equal(replayedStart.status, 200, JSON.stringify(replayedStart.body));
  const started = await client.query('SELECT id,version FROM "Trip" WHERE "vehicleId"=$1 AND status=\'IN_USE\'', [ids.vehicle]);
  assert.equal(started.rowCount, 1, "同一操作の同時送信でTripが重複しています");
  const startLogs = await client.query('SELECT id FROM "AuditLog" WHERE "operationId"=$1', [startOperationId]);
  assert.equal(startLogs.rowCount, 1, "同一操作の監査ログが重複しています");

  const vehicle = await client.query('SELECT version FROM "Vehicle" WHERE id=$1', [ids.vehicle]);
  const endOperationId = crypto.randomUUID(); operationIds.push(endOperationId);
  const endBody = { operationId: endOperationId, action: "end", tripId: started.rows[0].id, tripVersion: started.rows[0].version, vehicleId: ids.vehicle, vehicleVersion: vehicle.rows[0].version, spotId: ids.spot, actorName: "自動テスト", actorEmployeeId: ids.employee };
  const ended = await post(endBody);
  const replayedEnd = await post(endBody);
  assert.equal(ended.status, 200, JSON.stringify(ended.body));
  assert.equal(replayedEnd.status, 200, JSON.stringify(replayedEnd.body));
  assert.equal(replayedEnd.body.replayed, true, "返却の再送がreplayedとして処理されていません");
  const completed = await client.query('SELECT status FROM "Trip" WHERE id=$1', [started.rows[0].id]);
  assert.equal(completed.rows[0].status, "COMPLETED");

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
  console.log("API integration passed: start, duplicate suppression, return replay, reservation, edit and cancellation");
} finally {
  await cleanup().catch((error) => console.error("cleanup failed", error));
  await client.end();
}
