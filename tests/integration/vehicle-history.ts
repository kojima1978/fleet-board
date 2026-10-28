import assert from "node:assert/strict";
import { prisma } from "../../lib/prisma";
import { GET } from "../../app/api/trips/history/route";

if (new URL(process.env.DATABASE_URL ?? "").pathname !== "/fleet_history_test") throw new Error("Use only the disposable fleet_history_test database");
async function main() {
  try {
    const department = await prisma.department.create({ data: { name: "履歴テスト" } });
    const employee = await prisma.employee.create({ data: { name: "履歴 太郎", department: { connect: { id: department.id } }, employeeNumber: { create: { code: "E001" } }, qrToken: crypto.randomUUID() } });
    const other = await prisma.employee.create({ data: { name: "履歴 花子", department: { connect: { id: department.id } }, employeeNumber: { create: { code: "E002" } }, qrToken: crypto.randomUUID() } });
    const vehicle = await prisma.vehicle.create({ data: { name: "履歴テスト車", vehicleNumber: { create: { code: "C001" } }, plateNumber: "履歴001", qrToken: crypto.randomUUID(), active: false } });
    const otherVehicle = await prisma.vehicle.create({ data: { name: "別の車", vehicleNumber: { create: { code: "C002" } }, plateNumber: "履歴002", qrToken: crypto.randomUUID() } });
    const at = (value: string) => new Date(`${value}:00+09:00`);
    const base = { vehicleId: vehicle.id, employeeId: employee.id, plannedStart: at("2026-01-01T22:00"), plannedEnd: at("2026-01-02T02:00") };
    const overnight = await prisma.trip.create({ data: { ...base, actualStart: base.plannedStart, actualEnd: base.plannedEnd, status: "COMPLETED" } });
    const ongoing = await prisma.trip.create({ data: { ...base, employeeId: other.id, actualStart: at("2026-01-03T10:00"), status: "IN_USE" } });
    await prisma.trip.createMany({ data: [
      { ...base, status: "RESERVED" }, { ...base, status: "CANCELLED" },
      { ...base, status: "COMPLETED", actualStart: at("2026-01-01T10:00"), actualEnd: at("2026-01-01T11:00") },
      { ...base, vehicleId: otherVehicle.id, status: "COMPLETED", actualStart: base.plannedStart, actualEnd: base.plannedEnd },
    ] });
    async function get(params: Record<string, string> = {}) {
      const response = await GET(new Request(`http://localhost/api/trips/history?${new URLSearchParams(params)}`));
      return { response, data: await response.json() };
    }
    const vehiclesOnly = await get({ view: "vehicles" });
    assert.equal(vehiclesOnly.response.status, 200);
    assert.equal(vehiclesOnly.data.vehicles.length, 2);
    assert.equal(vehiclesOnly.data.records, undefined, "vehicle selection does not return trip history");
    let result = await get({ vehicleId: vehicle.id, from: "2026-01-02T00:30", to: "2026-01-02T00:30" });
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.data.records.map((item: { id: string }) => item.id), [overnight.id]);
    assert.equal(result.data.records[0].employee.name, employee.name);
    assert.equal(result.data.records[0].actualStart, base.plannedStart.toISOString());
    assert.equal(result.data.records[0].actualEnd, base.plannedEnd.toISOString());
    assert.equal(result.data.records[0].vehicle.vehicleNumber.code, "C001");
    assert.equal(result.data.records[0].vehicle.qrToken, undefined);
    assert.equal(result.data.records[0].employee.qrToken, undefined);
    assert.ok(result.data.vehicles.some((item: { id: string; active: boolean }) => item.id === vehicle.id && !item.active));
    assert.equal(result.response.headers.get("Cache-Control"), "no-store");
    result = await get({ vehicleId: vehicle.id, from: "2026-01-02T02:00", to: "2026-01-02T03:00" });
    assert.equal(result.data.pagination.total, 0, "returned at start of range is excluded");
    result = await get({ vehicleId: vehicle.id, from: "2026-01-03T12:00", q: "花子" });
    assert.deepEqual(result.data.records.map((item: { id: string }) => item.id), [ongoing.id]);
    result = await get({ vehicleId: vehicle.id, from: "2099-01-01T12:00" });
    assert.equal(result.data.pagination.total, 0, "ongoing trips do not claim future usage");
    assert.equal((await get({ from: "2026-02-30T00:00" })).response.status, 400);
    assert.equal((await get({ from: "2026-01-03T12:00", to: "2026-01-01T12:00" })).response.status, 400);
    await prisma.trip.createMany({ data: Array.from({ length: 52 }, (_, index) => ({ ...base, status: "COMPLETED" as const, actualStart: new Date(at("2025-12-01T10:00").getTime() + index * 60_000), actualEnd: at("2025-12-01T12:00") })) });
    const first = await get({ vehicleId: vehicle.id });
    const second = await get({ vehicleId: vehicle.id, page: "2" });
    assert.equal(first.data.pagination.total, 55);
    assert.equal(first.data.records.length, 50); assert.equal(second.data.records.length, 5);
    assert.equal(new Set([...first.data.records, ...second.data.records].map((item: { id: string }) => item.id)).size, 55);
    console.log("Vehicle history API passed: vehicle/employee filters, overnight use, exact moment, return boundary, ongoing/future, inactive cars, safe fields and pagination");
  } finally { await prisma.$disconnect(); }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
