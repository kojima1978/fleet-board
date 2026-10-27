import assert from "node:assert/strict";
import { prisma } from "../../lib/prisma";

// 利用者の開発・本番DBでは実行しない。使い捨てテストDB専用。
if (new URL(process.env.DATABASE_URL ?? "").pathname !== "/fleet_time_test") throw new Error("Use only the disposable fleet_time_test database");
const appUrl = process.env.APP_URL ?? "http://127.0.0.1:3000";
const now = Date.now();
const at = (minutes: number) => new Date(now + minutes * 60_000);
let sequence = 0;
async function post(body: object, id = crypto.randomUUID()) {
  const response = await fetch(`${appUrl}/api/dashboard`, { method: "POST", headers: { "Content-Type": "application/json", Origin: new URL(appUrl).origin }, body: JSON.stringify({ operationId: id, ...body }) });
  return { status: response.status, result: await response.json() };
}
async function employee() {
  const code = `E${String(++sequence).padStart(3, "0")}`;
  return prisma.employee.create({ data: { name: `時間訂正テスト${code}`, qrToken: crypto.randomUUID(), employeeNumber: { create: { code } }, department: { connectOrCreate: { where: { name: "時間テスト" }, create: { name: "時間テスト" } } } } });
}
async function vehicle(status: "AVAILABLE" | "IN_USE" = "AVAILABLE") {
  const code = `C${String(++sequence).padStart(3, "0")}`;
  const spot = await prisma.parkingSpot.create({ data: { code, x: 1, y: 1, width: 5, height: 5, orientation: "vertical" } });
  return prisma.vehicle.create({ data: { name: `時間テスト車${code}`, plateNumber: code, qrToken: crypto.randomUUID(), status, vehicleNumber: { create: { code } }, ...(status === "AVAILABLE" ? { parkingSpot: { connect: { id: spot.id } } } : {}) } });
}

async function main() {
try {
  sequence = await prisma.employeeNumber.count() + await prisma.vehicleNumber.count();
  const actor = await employee(); const user = await employee(); const user2 = await employee();
  const car = await vehicle(); const car2 = await vehicle("IN_USE"); const car3 = await vehicle();
  const reserved = await prisma.trip.create({ data: { employeeId: user.id, vehicleId: car.id, plannedStart: at(120), plannedEnd: at(180) } });
  const reservedBody = { action: "setReservationStart", tripId: reserved.id, version: 1, plannedStart: at(90).toISOString(), actorEmployeeId: actor.id };
  assert.equal((await post(reservedBody)).status, 200);
  let changed = await prisma.trip.findUniqueOrThrow({ where: { id: reserved.id } });
  assert.equal(changed.plannedEnd.toISOString(), reserved.plannedEnd.toISOString());
  assert.equal(changed.actualStart, null);
  assert.equal((await prisma.vehicle.findUniqueOrThrow({ where: { id: car.id } })).parkingSpotId, car.parkingSpotId);
  assert.equal((await post(reservedBody)).status, 409, "古い版は拒否");
  assert.equal((await post({ ...reservedBody, version: 2, plannedStart: at(-1).toISOString() })).status, 400);
  assert.equal((await post({ ...reservedBody, version: 2, plannedStart: at(175).toISOString() })).status, 400);
  const maintenance = await prisma.vehicleMaintenance.create({ data: { vehicleId: car.id, kind: "ON_SITE", status: "SCHEDULED", plannedStart: at(70), plannedEnd: at(85) } });
  const maintenanceResult = await post({ ...reservedBody, version: 2, plannedStart: at(75).toISOString() });
  assert.equal(maintenanceResult.status, 400); assert.match(maintenanceResult.result.message, /整備/);
  await prisma.vehicleMaintenance.update({ where: { id: maintenance.id }, data: { status: "COMPLETED" } });
  await prisma.trip.create({ data: { employeeId: user2.id, vehicleId: car.id, plannedStart: at(45), plannedEnd: at(80) } });
  assert.equal((await post({ ...reservedBody, version: 2, plannedStart: at(60).toISOString() })).status, 400, "別の予約と重なる変更を拒否");

  const used = await prisma.trip.create({ data: { employeeId: user2.id, vehicleId: car2.id, plannedStart: at(-60), plannedEnd: at(60), actualStart: at(-60), status: "IN_USE" } });
  const correction = { action: "correctActualStart", tripId: used.id, version: 1, actualStart: at(-90).toISOString(), reason: "出庫操作を忘れたため", actorEmployeeId: actor.id };
  const operationId = crypto.randomUUID();
  assert.equal((await post(correction, operationId)).status, 200);
  assert.equal((await post(correction, operationId)).result.replayed, true);
  changed = await prisma.trip.findUniqueOrThrow({ where: { id: used.id } });
  assert.equal(changed.actualStart!.toISOString(), correction.actualStart);
  assert.equal(changed.plannedStart.toISOString(), used.plannedStart.toISOString());
  assert.equal(changed.plannedEnd.toISOString(), used.plannedEnd.toISOString());
  assert.equal(changed.status, "IN_USE");
  assert.deepEqual(await prisma.vehicle.findUniqueOrThrow({ where: { id: car2.id } }), car2, "車両・駐車位置を変更しない");
  const audit = await prisma.auditLog.findUniqueOrThrow({ where: { operationId } });
  assert.match(audit.description, new RegExp(used.actualStart!.toISOString().replaceAll(".", "\\.")));
  assert.ok(audit.description.includes(correction.actualStart) && audit.description.includes(correction.reason));
  assert.equal(audit.actorEmployeeId, actor.id); assert.equal(audit.actorName, actor.name);
  assert.equal(await prisma.auditLog.count({ where: { operationId } }), 1);
  assert.equal((await post({ ...correction, version: 2, reason: "" })).status, 400);
  assert.equal((await post({ ...correction, version: 2, actorEmployeeId: undefined })).status, 400);
  assert.equal((await post({ ...correction, version: 2, actualStart: at(10).toISOString() })).status, 400);
  assert.equal((await post({ ...correction, actualStart: at(-85).toISOString() })).status, 409);
  await prisma.trip.create({ data: { employeeId: user.id, vehicleId: car2.id, plannedStart: at(-120), plannedEnd: at(-100), actualStart: at(-120), actualEnd: at(-100), status: "COMPLETED" } });
  assert.equal((await post({ ...correction, version: 2, actualStart: at(-110).toISOString() })).status, 400, "別の実利用との重複を拒否");
  const races = await Promise.all([-85, -80].map((minutes) => post({ ...correction, version: 2, actualStart: at(minutes).toISOString() })));
  assert.deepEqual(races.map((result) => result.status).sort(), [200, 409], "並行訂正は片方のみ成功");
  await prisma.trip.create({ data: { employeeId: user2.id, vehicleId: car3.id, plannedStart: at(-100), plannedEnd: at(-90), actualStart: at(-100), actualEnd: at(-90), status: "COMPLETED" } });
  assert.equal((await post({ ...correction, version: 3, actualStart: at(-95).toISOString() })).status, 400, "同じ利用者の別車両の実利用とも重複不可");

  const returned = await prisma.trip.create({ data: { employeeId: user.id, vehicleId: car3.id, plannedStart: at(-360), plannedEnd: at(-300), actualStart: at(-360), actualEnd: at(-300), status: "COMPLETED" } });
  const completeBody = { ...correction, tripId: returned.id, version: 1, actualStart: at(-390).toISOString() };
  assert.equal((await post(completeBody)).status, 200);
  assert.equal((await post({ ...completeBody, version: 2, actualStart: at(-290).toISOString() })).status, 400);
  const after = await prisma.trip.findUniqueOrThrow({ where: { id: returned.id } });
  assert.equal(after.actualEnd!.toISOString(), returned.actualEnd!.toISOString());
  assert.equal(after.status, "COMPLETED");
  assert.equal((await prisma.vehicle.findUniqueOrThrow({ where: { id: car3.id } })).parkingSpotId, car3.parkingSpotId);
  const listing = await fetch(`${appUrl}/api/trips/start-time?q=${encodeURIComponent(car3.name)}`).then((response) => response.json());
  assert.equal(listing.records.length, 2); assert.ok(listing.records.some((record: { id: string }) => record.id === returned.id));
  assert.equal(listing.records[0].vehicle.qrToken, undefined);
  console.log("Trip start API tests passed: reservation edits, immutable plans/parking, actual/completed corrections, actor/reason audit, replay, future/overlap/version rejection and concurrent update protection");
} finally { await prisma.$disconnect(); }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
