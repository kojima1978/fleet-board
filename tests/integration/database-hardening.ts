import assert from "node:assert/strict";
import { prisma } from "../../lib/prisma";
import { POST } from "../../app/api/dashboard/route";
import { GET as history } from "../../app/api/trips/history/route";
import { createFleetBackup, parseFleetBackup, restoreFleetBackup } from "../../lib/json-backup";

const database = new URL(process.env.DATABASE_URL ?? "");
if (database.hostname !== "fleetflow-db-hardening-test-db" || database.pathname !== "/fleet_hardening_test") throw new Error("Disposable hardening DB only");
const at = (minutes: number) => new Date(Date.now() + minutes * 60_000);
async function post(body: object) {
  const response = await POST(new Request("http://localhost/api/dashboard", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost" }, body: JSON.stringify({ operationId: crypto.randomUUID(), ...body }) }));
  assert.equal(response.status, 200, await response.text());
}
async function rejectDatabase(action: () => Promise<unknown>) {
  await assert.rejects(action, (error: unknown) => {
    assert.equal((error as Error).name, "PrismaClientKnownRequestError", "must fail in the database, not client validation");
    return true;
  });
}
async function main() {
  try {
    assert.equal(await prisma.employee.count(), 0, "run on a freshly migrated empty test DB");
    const department = await prisma.department.create({ data: { name: "開始時の部署" } });
    const employee = await prisma.employee.create({ data: { name: "開始時の社員", qrToken: crypto.randomUUID(), department: { connect: { id: department.id } }, employeeNumber: { create: { code: "E901" } } } });
    const employee2 = await prisma.employee.create({ data: { name: "社員2", qrToken: crypto.randomUUID(), department: { connect: { id: department.id } }, employeeNumber: { create: { code: "E902" } } } });
    const spot = await prisma.parkingSpot.create({ data: { code: "Review1", x: 1, y: 1, width: 5, height: 5, orientation: "vertical" } });
    const spot2 = await prisma.parkingSpot.create({ data: { code: "Review2", x: 2, y: 2, width: 5, height: 5, orientation: "vertical" } });
    const vehicle = await prisma.vehicle.create({ data: { name: "開始時の車両", plateNumber: "開始時ナンバー", qrToken: crypto.randomUUID(), vehicleNumber: { create: { code: "C901" } }, parkingSpot: { connect: { id: spot.id } } } });
    const vehicle2 = await prisma.vehicle.create({ data: { name: "車両2", plateNumber: "車両2", qrToken: crypto.randomUUID(), vehicleNumber: { create: { code: "C902" } }, parkingSpot: { connect: { id: spot2.id } } } });
    const base = { employeeId: employee.id, vehicleId: vehicle.id, plannedStart: at(-60), plannedEnd: at(60) };
    await rejectDatabase(() => prisma.trip.create({ data: { ...base, plannedEnd: at(-120) } }));
    await rejectDatabase(() => prisma.trip.create({ data: { ...base, status: "COMPLETED" } }));
    await rejectDatabase(() => prisma.vehicle.update({ where: { id: vehicle.id }, data: { fuelLevel: 999 } }));
    await rejectDatabase(() => prisma.parkingSpot.create({ data: { code: "Bad", x: 0, y: 0, width: 1, height: 1, orientation: "vertical", role: "DEDICATED", dedicatedVehicleId: "missing" } }));
    const tag = await prisma.nfcTag.create({ data: { uid: "REVIEW-1" } });
    await rejectDatabase(() => prisma.nfcAssignment.create({ data: { employeeId: employee.id, vehicleId: vehicle.id, nfcTagId: tag.id } }));
    await rejectDatabase(() => prisma.nfcAssignment.create({ data: { nfcTagId: tag.id } }));
    await rejectDatabase(() => prisma.nfcAssignment.create({ data: { employeeId: employee.id, nfcTagId: tag.id, validFrom: at(0), validTo: at(-1) } }));
    await prisma.nfcAssignment.create({ data: { employeeId: employee.id, nfcTagId: tag.id } });
    await rejectDatabase(() => prisma.nfcAssignment.create({ data: { employeeId: employee2.id, nfcTagId: tag.id } }));

    await post({ action: "start", employeeId: employee.id, vehicleId: vehicle.id, minutes: 60, actorEmployeeId: employee.id });
    let trip = await prisma.trip.findFirstOrThrow({ where: { vehicleId: vehicle.id, status: "IN_USE" } });
    assert.equal(trip.employeeNameAtStart, "開始時の社員"); assert.equal(trip.vehicleCodeAtStart, "C901");
    assert.ok(trip.snapshotCapturedAt);
    await rejectDatabase(() => prisma.trip.create({ data: { ...base, status: "IN_USE", actualStart: at(0), employeeId: employee2.id } }));
    await rejectDatabase(() => prisma.trip.create({ data: { ...base, status: "IN_USE", actualStart: at(0), vehicleId: vehicle2.id } }));
    await rejectDatabase(() => prisma.trip.update({ where: { id: trip.id }, data: { employeeNameAtStart: "上書き" } }));
    await prisma.employee.update({ where: { id: employee.id }, data: { name: "変更後の社員" } });
    await prisma.employeeNumber.update({ where: { id: employee.employeeNumberId }, data: { code: "E911" } });
    await prisma.department.update({ where: { id: department.id }, data: { name: "変更後の部署" } });
    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { name: "変更後の車両", plateNumber: "変更後ナンバー" } });
    await prisma.vehicleNumber.update({ where: { id: vehicle.vehicleNumberId }, data: { code: "C911" } });
    const result = await history(new Request(`http://localhost/api/trips/history?vehicleId=${vehicle.id}&q=${encodeURIComponent("開始時の社員")}`)).then((response) => response.json());
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].employee.name, "変更後の社員");
    assert.equal(result.records[0].employeeNameAtStart, "開始時の社員");
    assert.equal(result.records[0].departmentNameAtStart, "開始時の部署");
    assert.equal(result.records[0].plateNumberAtStart, "開始時ナンバー");
    await post({ action: "correctActualStart", tripId: trip.id, version: trip.version, actualStart: at(-1).toISOString(), reason: "テスト訂正", actorEmployeeId: employee.id });
    trip = await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } });
    assert.equal(trip.employeeNameAtStart, "開始時の社員");
    const currentCar = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
    await post({ action: "end", tripId: trip.id, vehicleId: vehicle.id, spotId: spot.id, tripVersion: trip.version, vehicleVersion: currentCar.version, fuelLevel: 2, actorEmployeeId: employee.id });
    await post({ action: "undoReturn", tripId: trip.id, vehicleId: vehicle.id, actorEmployeeId: employee.id });
    trip = await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } });
    assert.equal(trip.status, "IN_USE"); assert.equal(trip.employeeNameAtStart, "開始時の社員");
    const afterUndo = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
    await post({ action: "end", tripId: trip.id, vehicleId: vehicle.id, spotId: spot.id, tripVersion: trip.version, vehicleVersion: afterUndo.version, fuelLevel: 3, actorEmployeeId: employee.id });

    await post({ action: "reserve", employeeId: employee2.id, vehicleId: vehicle2.id, plannedStart: at(1).toISOString(), minutes: 60, actorEmployeeId: employee2.id });
    const reserved = await prisma.trip.findFirstOrThrow({ where: { vehicleId: vehicle2.id, status: "RESERVED" } });
    assert.equal(reserved.snapshotCapturedAt, null);
    await prisma.employee.update({ where: { id: employee2.id }, data: { name: "予約後の社員2" } });
    await post({ action: "start", employeeId: employee2.id, vehicleId: vehicle2.id, minutes: 30, actorEmployeeId: employee2.id });
    assert.equal((await prisma.trip.findUniqueOrThrow({ where: { id: reserved.id } })).employeeNameAtStart, "予約後の社員2");

    const maintenance = await prisma.vehicleMaintenance.create({ data: { vehicleId: vehicle.id, kind: "ON_SITE", status: "ACTIVE", plannedStart: at(0), actualStart: at(0) } });
    await rejectDatabase(() => prisma.vehicleMaintenance.create({ data: { vehicleId: vehicle.id, kind: "ON_SITE", status: "ACTIVE", plannedStart: at(0), actualStart: at(0) } }));
    await prisma.vehicleMaintenance.update({ where: { id: maintenance.id }, data: { status: "COMPLETED", actualEnd: at(1) } });
    const dedicated = await prisma.parkingSpot.create({ data: { code: "Dedicated", x: 3, y: 3, width: 5, height: 5, orientation: "vertical", role: "DEDICATED", dedicatedVehicleId: vehicle.id } });
    const backup = parseFleetBackup(await createFleetBackup());
    const badState = structuredClone(backup);
    badState.data.trips[0].actualStart = null;
    assert.throws(() => parseFleetBackup(badState));
    const badSnapshot = structuredClone(backup);
    badSnapshot.data.trips[0].employeeNameAtStart = null;
    assert.throws(() => parseFleetBackup(badSnapshot));
    const badDoubleUse = structuredClone(backup);
    const active = badDoubleUse.data.trips.find((item) => item.status === "IN_USE")!;
    badDoubleUse.data.trips.push({ ...active, id: "duplicate-in-use" });
    assert.throws(() => parseFleetBackup(badDoubleUse));
    await restoreFleetBackup(backup);
    assert.equal((await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).employeeNameAtStart, "開始時の社員");
    assert.equal((await prisma.parkingSpot.findUniqueOrThrow({ where: { id: dedicated.id } })).dedicatedVehicleId, vehicle.id);
    const oldBackup = JSON.parse(JSON.stringify(backup));
    for (const record of oldBackup.data.trips) for (const field of ["snapshotCapturedAt", "employeeNameAtStart", "employeeCodeAtStart", "departmentNameAtStart", "vehicleNameAtStart", "vehicleCodeAtStart", "plateNumberAtStart"]) delete record[field];
    const legacy = parseFleetBackup(oldBackup);
    assert.ok(legacy.data.trips.every((item) => item.snapshotCapturedAt === null));
    await restoreFleetBackup(legacy);
    assert.equal((await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).snapshotCapturedAt, null);
    console.log("Database hardening passed: SQL checks/unique/FK, start/reservation snapshots, rename/search, immutable history, correction/return/undo, invalid JSON rejection, deferred FK restore and legacy backup compatibility");
  } finally { await prisma.$disconnect(); }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
