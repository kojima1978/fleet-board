import assert from "node:assert/strict";
import { prisma } from "../../lib/prisma";
import { POST } from "../../app/api/dashboard/route";

const database = new URL(process.env.DATABASE_URL ?? "");
if (database.hostname !== "fleetflow-reservation-test-db" || database.pathname !== "/fleet_reservation_test") throw new Error("Disposable reservation test DB only");
const baseTime = Date.now();
const at = (minutes: number) => new Date(baseTime + minutes * 60_000);
async function post(body: object, operationId = crypto.randomUUID()) {
  const response = await POST(new Request("http://localhost/api/dashboard", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost" }, body: JSON.stringify({ operationId, ...body }) }));
  return { status: response.status, body: await response.json() };
}
async function main() {
  try {
    assert.equal(await prisma.trip.count(), 0, "use an empty migrated disposable DB");
    const department = await prisma.department.upsert({ where: { name: "時間変更テスト" }, create: { name: "時間変更テスト" }, update: {} });
    const employee = await prisma.employee.create({ data: { name: "予約テスト社員", qrToken: crypto.randomUUID(), department: { connect: { id: department.id } }, employeeNumber: { create: { code: "E901" } } } });
    const vehicle = await prisma.vehicle.create({ data: { name: "予約テスト車両", plateNumber: "テスト", qrToken: crypto.randomUUID(), vehicleNumber: { create: { code: "C901" } } } });
    const reserved = await prisma.trip.create({ data: { employeeId: employee.id, vehicleId: vehicle.id, plannedStart: at(120), plannedEnd: at(180) } });
    const body = { action: "moveTrip", tripId: reserved.id, version: reserved.version, plannedStart: at(150).toISOString(), plannedEnd: at(240).toISOString(), actorEmployeeId: employee.id };
    const operationId = crypto.randomUUID();
    assert.equal((await post(body, operationId)).status, 200);
    assert.equal((await post(body, operationId)).body.replayed, true);
    const changed = await prisma.trip.findUniqueOrThrow({ where: { id: reserved.id } });
    assert.equal(changed.plannedStart.toISOString(), body.plannedStart);
    assert.equal(changed.plannedEnd.toISOString(), body.plannedEnd);
    assert.equal(changed.actualStart, null);
    assert.equal(changed.version, reserved.version + 1);
    const audit = await prisma.auditLog.findUniqueOrThrow({ where: { operationId } });
    for (const value of [reserved.plannedStart.toISOString(), reserved.plannedEnd.toISOString(), body.plannedStart, body.plannedEnd]) assert.ok(audit.description.includes(value));
    assert.equal((await post(body)).status, 409, "stale updates rejected");
    const updatedBody = { ...body, version: changed.version };
    for (const [start, end] of [[-30, 30], [300, 310], [300, 300 + 10_081]]) {
      assert.equal((await post({ ...updatedBody, plannedStart: at(start).toISOString(), plannedEnd: at(end).toISOString() })).status, 400);
    }
    await prisma.trip.create({ data: { employeeId: employee.id, vehicleId: vehicle.id, plannedStart: at(300), plannedEnd: at(360) } });
    assert.equal((await post({ ...updatedBody, plannedStart: at(330).toISOString(), plannedEnd: at(390).toISOString() })).status, 400, "overlap rejected");
    await prisma.vehicleMaintenance.create({ data: { vehicleId: vehicle.id, kind: "ON_SITE", status: "SCHEDULED", plannedStart: at(420), plannedEnd: at(480) } });
    assert.equal((await post({ ...updatedBody, plannedStart: at(450).toISOString(), plannedEnd: at(510).toISOString() })).status, 400, "maintenance overlap rejected");
    assert.deepEqual(await prisma.trip.findUniqueOrThrow({ where: { id: reserved.id } }), changed, "failed saves leave both dates unchanged");
    console.log("Reservation time change passed: atomic period save, audit, replay, stale version, time limits and overlaps");
  } finally { await prisma.$disconnect(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
