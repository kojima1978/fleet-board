import assert from "node:assert/strict";
import pg from "pg";
import { freeRecordCodes } from "./record-codes.mjs";

const appUrl = process.env.APP_URL || "http://127.0.0.1:3000";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const suffix = Date.now().toString(36);
const ids = { department: `mt-dept-${suffix}`, employeeNumber: `mt-en-${suffix}`, employee: `mt-employee-${suffix}`, vehicles: [0, 1].map((i) => `mt-vehicle-${suffix}-${i}`), numbers: [0, 1].map((i) => `mt-vn-${suffix}-${i}`), spots: [0, 1, 2].map((i) => `mt-spot-${suffix}-${i}`) };
const spotCodes = ids.spots.map((_, i) => `M${suffix}${i}`);
const operationIds = [];
const hour = 60 * 60_000;
const base = Math.ceil(Date.now() / (15 * 60_000)) * 15 * 60_000;
const at = (hours) => new Date(base + hours * hour).toISOString();

async function post(body) {
  const operationId = crypto.randomUUID();
  operationIds.push(operationId);
  const response = await fetch(`${appUrl}/api/dashboard`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: new URL(appUrl).origin },
    body: JSON.stringify({ operationId, ...body }),
  });
  return { status: response.status, body: await response.json() };
}
const vehicle = async (i) => (await client.query('SELECT * FROM "Vehicle" WHERE id=$1', [ids.vehicles[i]])).rows[0];
const maintenances = async (i) => (await client.query('SELECT * FROM "VehicleMaintenance" WHERE "vehicleId"=$1 ORDER BY "createdAt"', [ids.vehicles[i]])).rows;
const reserve = (i, startHours, minutes = 60) => post({ action: "reserve", employeeId: ids.employee, vehicleId: ids.vehicles[i], plannedStart: at(startHours), minutes, actorName: "自動テスト" });
const expect = (result, status, message) => assert.equal(result.status, status, `${message}: ${JSON.stringify(result.body)}`);

await client.connect();
try {
  const [employeeCode] = await freeRecordCodes(client, "EmployeeNumber", "V", 1);
  const vehicleCodes = await freeRecordCodes(client, "VehicleNumber", "V", 2);
  const now = new Date();
  await client.query('INSERT INTO "Department" (id,name,active,"createdAt","updatedAt") VALUES ($1,$2,true,$3,$3)', [ids.department, `整備テスト${suffix}`, now]);
  await client.query('INSERT INTO "EmployeeNumber" (id,code,"createdAt","updatedAt") VALUES ($1,$2,$3,$3)', [ids.employeeNumber, employeeCode, now]);
  await client.query('INSERT INTO "Employee" (id,"employeeNumberId","departmentId",name,"qrToken",active,version,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,true,1,$6,$6)', [ids.employee, ids.employeeNumber, ids.department, `整備テスト社員${suffix}`, `MAINE_${suffix}`, now]);
  for (const [i, id] of ids.spots.entries()) await client.query('INSERT INTO "ParkingSpot" (id,code,x,y,width,height,orientation,enabled,version) VALUES ($1,$2,0,0,5,5,\'horizontal\',true,1)', [id, spotCodes[i]]);
  for (const [i, id] of ids.vehicles.entries()) {
    await client.query('INSERT INTO "VehicleNumber" (id,code,"createdAt","updatedAt") VALUES ($1,$2,$3,$3)', [ids.numbers[i], vehicleCodes[i], now]);
    await client.query('INSERT INTO "Vehicle" (id,"vehicleNumberId",name,"plateNumber",color,"qrToken",active,status,"parkingSpotId",version,"createdAt","updatedAt") VALUES ($1,$2,$3,$4,\'#2563eb\',$5,true,\'AVAILABLE\',$6,1,$7,$7)', [id, ids.numbers[i], `整備テスト車${i}`, `MT-${suffix}-${i}`, `MAINV_${suffix}_${i}`, ids.spots[i], now]);
  }

  // 車検で外出すると区画を空け、他の車両を停められる。
  expect(await post({ action: "startMaintenance", vehicleId: ids.vehicles[0], version: (await vehicle(0)).version, kind: "OFF_SITE", note: "車検", plannedEnd: at(2) }), 200, "車検で外出を開始する");
  let car = await vehicle(0);
  assert.deepEqual([car.status, car.parkingSpotId], ["MAINTENANCE", null], "車検で外出すると区画を空ける");
  let [record] = await maintenances(0);
  assert.deepEqual([record.kind, record.status, record.note], ["OFF_SITE", "ACTIVE", "車検"]);
  expect(await post({ action: "moveVehicle", vehicleId: ids.vehicles[1], version: (await vehicle(1)).version, spotId: ids.spots[0], actorName: "自動テスト" }), 200, "空いた区画へ他の車両を移動できる");
  expect(await post({ action: "moveVehicle", vehicleId: ids.vehicles[1], version: (await vehicle(1)).version, spotId: ids.spots[1], actorName: "自動テスト" }), 200, "他の車両を元の区画へ戻す");
  expect(await post({ action: "startMaintenance", vehicleId: ids.vehicles[0], version: car.version, kind: "ON_SITE" }), 400, "整備中の車両は重ねて開始できない");
  const dashboard = await (await fetch(`${appUrl}/api/dashboard`)).json();
  assert.ok(dashboard.maintenances.some((item) => item.id === record.id && item.status === "ACTIVE"), "画面用のデータに整備中の記録を返す");

  // 戻り予定より前は予約できず、後なら予約できる。戻り予定を予約に重ねる変更も拒否する。
  expect(await reserve(0, 1), 400, "戻り予定より前の予約を拒否する");
  expect(await reserve(0, 3), 200, "戻り予定より後の予約を受け付ける");
  expect(await post({ action: "updateMaintenance", maintenanceId: record.id, version: record.version, note: "車検", plannedEnd: at(4) }), 400, "戻り予定を予約に重ねられない");
  expect(await post({ action: "updateMaintenance", maintenanceId: record.id, version: record.version, note: "車検・タイヤ交換", plannedEnd: at(2.5) }), 200, "戻り予定と備考を変更する");

  // 戻ったときは、区画の指定がなければ駐車位置は未設定になる。
  expect(await post({ action: "endMaintenance", vehicleId: ids.vehicles[0], version: (await vehicle(0)).version, fromSettings: true }), 200, "車検から戻す");
  car = await vehicle(0);
  [record] = await maintenances(0);
  assert.deepEqual([car.status, car.parkingSpotId, record.status, record.returnSpotCode, record.note], ["AVAILABLE", null, "COMPLETED", null, "車検・タイヤ交換"]);
  assert.ok(record.actualEnd, "戻った日時を記録する");

  // 整備予定は予約と重ねられず、予約や延長も整備予定と重ねられない。
  expect(await post({ action: "scheduleMaintenance", vehicleId: ids.vehicles[0], kind: "OFF_SITE", plannedStart: at(3.5), plannedEnd: at(5) }), 400, "予約と重なる整備予定を拒否する");
  expect(await post({ action: "scheduleMaintenance", vehicleId: ids.vehicles[0], kind: "OFF_SITE", plannedStart: at(24), plannedEnd: at(48) }), 200, "整備予定を登録する");
  let scheduled = (await maintenances(0)).find((item) => item.status === "SCHEDULED");
  expect(await reserve(0, 30), 400, "整備予定と重なる予約を拒否する");
  expect(await reserve(0, 20, 300), 400, "整備予定にかかる予約を拒否する");
  expect(await reserve(0, 20, 180), 200, "整備予定の前の予約を受け付ける");
  const trip = (await client.query('SELECT id,version FROM "Trip" WHERE "vehicleId"=$1 AND "plannedStart"=$2', [ids.vehicles[0], at(20)])).rows[0];
  expect(await post({ action: "adjustTrip", tripId: trip.id, version: trip.version, minutes: 180, actorName: "自動テスト" }), 400, "整備予定へ延長できない");
  expect(await post({ action: "scheduleMaintenance", vehicleId: ids.vehicles[0], kind: "ON_SITE", plannedStart: at(40), plannedEnd: at(50) }), 400, "整備予定どうしは重ねられない");
  expect(await post({ action: "updateMaintenance", maintenanceId: scheduled.id, version: scheduled.version, plannedStart: at(50), plannedEnd: at(60) }), 200, "整備予定を動かす");
  expect(await reserve(0, 30), 200, "動かした後の空き時間は予約できる");
  scheduled = (await maintenances(0)).find((item) => item.id === scheduled.id);
  expect(await post({ action: "cancelMaintenance", maintenanceId: scheduled.id, version: scheduled.version }), 200, "整備予定を取り消す");
  assert.equal((await maintenances(0)).find((item) => item.id === scheduled.id).status, "CANCELLED");

  // 予定を開始すると同じ記録が整備中になり、戻るときは別の区画も選べる。
  expect(await post({ action: "scheduleMaintenance", vehicleId: ids.vehicles[0], kind: "OFF_SITE", plannedStart: at(70), plannedEnd: at(80) }), 200, "2件目の整備予定を登録する");
  scheduled = (await maintenances(0)).find((item) => item.status === "SCHEDULED");
  expect(await post({ action: "startMaintenance", vehicleId: ids.vehicles[0], version: (await vehicle(0)).version, kind: "ON_SITE", maintenanceId: scheduled.id }), 200, "整備予定を前倒しで開始する");
  const startedRecord = (await maintenances(0)).find((item) => item.id === scheduled.id);
  assert.deepEqual([startedRecord.status, startedRecord.kind, startedRecord.plannedEnd], ["ACTIVE", "ON_SITE", null]);
  expect(await post({ action: "endMaintenance", vehicleId: ids.vehicles[0], version: (await vehicle(0)).version, spotId: ids.spots[2], fromSettings: true }), 200, "別の区画へ戻す");
  assert.equal((await vehicle(0)).parkingSpotId, ids.spots[2]);
  assert.equal((await maintenances(0)).find((item) => item.id === scheduled.id).returnSpotCode, spotCodes[2]);

  // 戻り予定が未定の整備中は予約できない。戻る区画が使用中なら拒否する。
  expect(await post({ action: "startMaintenance", vehicleId: ids.vehicles[1], version: (await vehicle(1)).version, kind: "ON_SITE", note: "エンジン警告灯" }), 200, "故障で整備中にする");
  expect(await reserve(1, 3), 400, "戻り予定が未定なら予約できない");
  expect(await post({ action: "endMaintenance", vehicleId: ids.vehicles[1], version: (await vehicle(1)).version, spotId: ids.spots[2], fromSettings: true }), 400, "使用中の区画へは戻せない");
  expect(await post({ action: "endMaintenance", vehicleId: ids.vehicles[1], version: (await vehicle(1)).version, fromSettings: true }), 200, "元の区画で整備を解除する");
  assert.deepEqual([(await vehicle(1)).status, (await vehicle(1)).parkingSpotId], ["AVAILABLE", ids.spots[1]]);
  console.log("Vehicle maintenance passed: off-site spot release, return date reservations, return to original or chosen spot, schedules blocking reservations and extensions, cancel and early start");
} finally {
  await client.query('DELETE FROM "AuditLog" WHERE "operationId"=ANY($1::text[])', [operationIds]);
  await client.query('DELETE FROM "Trip" WHERE "vehicleId"=ANY($1::text[]) OR "employeeId"=$2', [ids.vehicles, ids.employee]);
  await client.query('DELETE FROM "VehicleMaintenance" WHERE "vehicleId"=ANY($1::text[])', [ids.vehicles]);
  await client.query('DELETE FROM "Vehicle" WHERE id=ANY($1::text[])', [ids.vehicles]);
  await client.query('DELETE FROM "VehicleNumber" WHERE id=ANY($1::text[])', [ids.numbers]);
  await client.query('DELETE FROM "ParkingSpot" WHERE id=ANY($1::text[])', [ids.spots]);
  await client.query('DELETE FROM "Employee" WHERE id=$1', [ids.employee]);
  await client.query('DELETE FROM "EmployeeNumber" WHERE id=$1', [ids.employeeNumber]);
  await client.query('DELETE FROM "Department" WHERE id=$1', [ids.department]);
  await client.end();
}
