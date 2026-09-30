import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function todayInTokyo() {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const start = new Date(`${day}T00:00:00+09:00`);
  return { start, end: new Date(start.getTime() + 3 * 24 * 60 * 60_000) };
}

async function assertNfcAvailable(nfcUid: string, exclude?: { employeeId?: string; vehicleId?: string }) {
  const [employee, vehicle] = await Promise.all([
    prisma.employee.findFirst({ where: { nfcUid: { equals: nfcUid, mode: "insensitive" }, id: exclude?.employeeId ? { not: exclude.employeeId } : undefined }, select: { name: true } }),
    prisma.vehicle.findFirst({ where: { nfcUid: { equals: nfcUid, mode: "insensitive" }, id: exclude?.vehicleId ? { not: exclude.vehicleId } : undefined }, select: { name: true } }),
  ]);
  const owner = employee?.name ?? vehicle?.name;
  if (owner) throw new Error(`このNFC UIDは「${owner}」で登録済みです`);
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createEmployee"), code: z.string().trim().min(1).max(20), name: z.string().trim().min(1).max(50), department: z.string().trim().min(1).max(50), nfcUid: z.string().trim().min(1).max(100) }),
  z.object({ action: z.literal("createVehicle"), code: z.string().trim().min(1).max(20), name: z.string().trim().min(1).max(50), plateNumber: z.string().trim().min(1).max(30), nfcUid: z.string().trim().min(1).max(100), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
  z.object({ action: z.literal("updateEmployee"), id: z.string(), version: z.number().int(), name: z.string().trim().min(1).max(50), department: z.string().trim().min(1).max(50), nfcUid: z.string().trim().min(1).max(100) }),
  z.object({ action: z.literal("updateVehicle"), id: z.string(), version: z.number().int(), name: z.string().trim().min(1).max(50), plateNumber: z.string().trim().min(1).max(30), nfcUid: z.string().trim().min(1).max(100), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
  z.object({ action: z.literal("setEmployeeActive"), id: z.string(), version: z.number().int(), active: z.boolean() }),
  z.object({ action: z.literal("setVehicleActive"), id: z.string(), version: z.number().int(), active: z.boolean() }),
  z.object({ action: z.literal("start"), employeeId: z.string(), vehicleId: z.string(), minutes: z.number().int().min(15).max(10_080), actorName: z.string() }),
  z.object({ action: z.literal("end"), tripId: z.string(), tripVersion: z.number().int(), vehicleId: z.string(), vehicleVersion: z.number().int(), spotId: z.string(), actorName: z.string() }),
  z.object({ action: z.literal("moveTrip"), tripId: z.string(), version: z.number().int(), plannedStart: z.string().datetime(), plannedEnd: z.string().datetime(), actorName: z.string() }),
  z.object({ action: z.literal("adjustTrip"), tripId: z.string(), version: z.number().int(), minutes: z.union([z.literal(-60), z.literal(-30), z.literal(-15), z.literal(15), z.literal(30), z.literal(60)]), actorName: z.string() }),
  z.object({ action: z.literal("cancelTrip"), tripId: z.string(), version: z.number().int(), actorName: z.string() }),
  z.object({ action: z.literal("moveVehicle"), vehicleId: z.string(), version: z.number().int(), spotId: z.string(), actorName: z.string() }),
]);

export async function GET(request: Request) {
  const defaults = todayInTokyo();
  const url = new URL(request.url);
  const requestedStart = url.searchParams.get("from");
  const parsedStart = requestedStart ? new Date(requestedStart) : defaults.start;
  const dayStart = Number.isNaN(parsedStart.getTime()) ? defaults.start : parsedStart;
  const requestedDays = Number(url.searchParams.get("days"));
  const days = requestedDays === 1 || requestedDays === 3 ? requestedDays : 3;
  const dayEnd = new Date(dayStart.getTime() + days * 24 * 60 * 60_000);
  const [employees, vehicles, spots, trips] = await Promise.all([
    prisma.employee.findMany({ orderBy: { code: "asc" } }),
    prisma.vehicle.findMany({ orderBy: { code: "asc" } }),
    prisma.parkingSpot.findMany({ include: { vehicle: true }, orderBy: { code: "asc" } }),
    prisma.trip.findMany({
      where: requestedStart
        ? { plannedStart: { lt: dayEnd }, plannedEnd: { gt: dayStart }, status: { not: "CANCELLED" } }
        : { OR: [{ plannedStart: { lt: dayEnd }, plannedEnd: { gt: dayStart }, status: { not: "CANCELLED" } }, { status: "IN_USE" }] },
      include: { employee: true, vehicle: true }, orderBy: { plannedStart: "asc" },
    }),
  ]);
  return NextResponse.json({ employees, vehicles, spots, trips });
}

export async function POST(request: Request) {
  const parsed = actionSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ message: "入力内容を確認してください" }, { status: 400 });
  const input = parsed.data;
  try {
    if (input.action === "createEmployee") {
      await assertNfcAvailable(input.nfcUid);
      const employee = await prisma.employee.create({ data: { code: input.code, name: input.name, department: input.department, nfcUid: input.nfcUid } });
      await prisma.auditLog.create({ data: { actorName: "設定画面", action: "社員登録", targetType: "Employee", targetId: employee.id, description: `${employee.code} ${employee.name}を登録` } });
    }
    if (input.action === "createVehicle") {
      await assertNfcAvailable(input.nfcUid);
      const vehicle = await prisma.vehicle.create({ data: { code: input.code, name: input.name, plateNumber: input.plateNumber, nfcUid: input.nfcUid, color: input.color } });
      await prisma.auditLog.create({ data: { actorName: "設定画面", action: "車両登録", targetType: "Vehicle", targetId: vehicle.id, description: `${vehicle.code} ${vehicle.name}を登録` } });
    }
    if (input.action === "updateEmployee") {
      await assertNfcAvailable(input.nfcUid, { employeeId: input.id });
      const updated = await prisma.employee.updateMany({ where: { id: input.id, version: input.version }, data: { name: input.name, department: input.department, nfcUid: input.nfcUid, version: { increment: 1 } } });
      if (updated.count !== 1) throw new Error("CONFLICT");
      await prisma.auditLog.create({ data: { actorName: "設定画面", action: "社員情報修正", targetType: "Employee", targetId: input.id, description: `${input.name}の登録情報を修正` } });
    }
    if (input.action === "updateVehicle") {
      await assertNfcAvailable(input.nfcUid, { vehicleId: input.id });
      const updated = await prisma.vehicle.updateMany({ where: { id: input.id, version: input.version }, data: { name: input.name, plateNumber: input.plateNumber, nfcUid: input.nfcUid, color: input.color, version: { increment: 1 } } });
      if (updated.count !== 1) throw new Error("CONFLICT");
      await prisma.auditLog.create({ data: { actorName: "設定画面", action: "車両情報修正", targetType: "Vehicle", targetId: input.id, description: `${input.name}の登録情報を修正` } });
    }
    if (input.action === "setEmployeeActive") {
      await prisma.$transaction(async (tx) => {
        if (!input.active) {
          const activeTrip = await tx.trip.findFirst({ where: { employeeId: input.id, status: { in: ["RESERVED", "IN_USE"] } } });
          if (activeTrip) throw new Error("利用中または予約中の社員は無効化できません");
        }
        const updated = await tx.employee.updateMany({ where: { id: input.id, version: input.version }, data: { active: input.active, version: { increment: 1 } } });
        if (updated.count !== 1) throw new Error("CONFLICT");
        await tx.auditLog.create({ data: { actorName: "設定画面", action: input.active ? "社員再有効化" : "社員無効化", targetType: "Employee", targetId: input.id, description: input.active ? "社員を再有効化" : "社員を無効化" } });
      });
    }
    if (input.action === "setVehicleActive") {
      await prisma.$transaction(async (tx) => {
        const vehicle = await tx.vehicle.findUniqueOrThrow({ where: { id: input.id } });
        if (!input.active && vehicle.status !== "AVAILABLE") throw new Error("利用中または予約中の車両は無効化できません");
        const updated = await tx.vehicle.updateMany({ where: { id: input.id, version: input.version }, data: { active: input.active, parkingSpotId: input.active ? vehicle.parkingSpotId : null, version: { increment: 1 } } });
        if (updated.count !== 1) throw new Error("CONFLICT");
        await tx.auditLog.create({ data: { actorName: "設定画面", action: input.active ? "車両再有効化" : "車両無効化", targetType: "Vehicle", targetId: input.id, description: input.active ? "車両を再有効化" : "車両を無効化" } });
      });
    }
    if (input.action === "start") {
      const now = new Date();
      const plannedEnd = new Date(now.getTime() + input.minutes * 60_000);
      await prisma.$transaction(async (tx) => {
        const [vehicle, employee] = await Promise.all([tx.vehicle.findUniqueOrThrow({ where: { id: input.vehicleId } }), tx.employee.findUniqueOrThrow({ where: { id: input.employeeId } })]);
        if (!vehicle.active || vehicle.status !== "AVAILABLE") throw new Error("この車両は現在利用できません");
        if (!employee.active) throw new Error("この社員は現在利用できません");
        const updated = await tx.vehicle.updateMany({ where: { id: vehicle.id, version: vehicle.version }, data: { status: "IN_USE", parkingSpotId: null, version: { increment: 1 } } });
        if (updated.count !== 1) throw new Error("CONFLICT");
        await tx.trip.create({ data: { employeeId: input.employeeId, vehicleId: input.vehicleId, plannedStart: now, plannedEnd, actualStart: now, status: "IN_USE", purpose: "" } });
        await tx.auditLog.create({ data: { actorName: input.actorName, action: "利用開始", targetType: "Vehicle", targetId: input.vehicleId, description: `${input.minutes}分の利用を開始` } });
      });
    }
    if (input.action === "end") {
      await prisma.$transaction(async (tx) => {
        const target = await tx.parkingSpot.findUniqueOrThrow({ where: { id: input.spotId }, include: { vehicle: true } });
        if (target.vehicle && target.vehicle.id !== input.vehicleId) throw new Error(`区画${target.code}は使用中です`);
        const trip = await tx.trip.updateMany({ where: { id: input.tripId, version: input.tripVersion, status: "IN_USE" }, data: { status: "COMPLETED", actualEnd: new Date(), returnSpotCode: target.code, version: { increment: 1 } } });
        const vehicle = await tx.vehicle.updateMany({ where: { id: input.vehicleId, version: input.vehicleVersion }, data: { status: "AVAILABLE", parkingSpotId: input.spotId, version: { increment: 1 } } });
        if (trip.count !== 1 || vehicle.count !== 1) throw new Error("CONFLICT");
        await tx.auditLog.create({ data: { actorName: input.actorName, action: "返却", targetType: "Trip", targetId: input.tripId, description: `区画${target.code}へ返却` } });
      });
    }
    if (input.action === "moveTrip") {
      const updated = await prisma.trip.updateMany({ where: { id: input.tripId, version: input.version }, data: { plannedStart: new Date(input.plannedStart), plannedEnd: new Date(input.plannedEnd), version: { increment: 1 } } });
      if (updated.count !== 1) throw new Error("CONFLICT");
      await prisma.auditLog.create({ data: { actorName: input.actorName, action: "利用時間修正", targetType: "Trip", targetId: input.tripId, description: "タイムラインから時間を変更" } });
    }
    if (input.action === "adjustTrip") {
      await prisma.$transaction(async (tx) => {
        const trip = await tx.trip.findUniqueOrThrow({ where: { id: input.tripId } });
        if (trip.status !== "RESERVED" && trip.status !== "IN_USE") throw new Error("完了・取消済みの予定時間は変更できません");
        const newEnd = new Date(trip.plannedEnd.getTime() + input.minutes * 60_000);
        const minimumEnd = new Date(trip.plannedStart.getTime() + 15 * 60_000);
        if (newEnd < minimumEnd) throw new Error("利用時間は15分未満にできません");
        if (trip.status === "IN_USE" && newEnd < new Date()) throw new Error("利用中の終了予定を現在時刻より前にはできません");
        if (input.minutes > 0) {
          const overlap = await tx.trip.findFirst({ where: { id: { not: trip.id }, vehicleId: trip.vehicleId, status: { in: ["RESERVED", "IN_USE"] }, plannedStart: { lt: newEnd }, plannedEnd: { gt: trip.plannedEnd } } });
          if (overlap) throw new Error("延長時間が次の予約と重なります");
        }
        const updated = await tx.trip.updateMany({ where: { id: trip.id, version: input.version }, data: { plannedEnd: newEnd, version: { increment: 1 } } });
        if (updated.count !== 1) throw new Error("CONFLICT");
        const direction = input.minutes > 0 ? "延長" : "短縮";
        await tx.auditLog.create({ data: { actorName: input.actorName, action: `利用時間${direction}`, targetType: "Trip", targetId: trip.id, description: `${Math.abs(input.minutes)}分${direction}` } });
      });
    }
    if (input.action === "cancelTrip") {
      const updated = await prisma.trip.updateMany({ where: { id: input.tripId, version: input.version, status: "RESERVED" }, data: { status: "CANCELLED", version: { increment: 1 } } });
      if (updated.count !== 1) throw new Error("予約済みの予定だけ取り消せます");
      await prisma.auditLog.create({ data: { actorName: input.actorName, action: "予約取消", targetType: "Trip", targetId: input.tripId, description: "タイムラインから予約を取り消し" } });
    }
    if (input.action === "moveVehicle") {
      const target = await prisma.parkingSpot.findUniqueOrThrow({ where: { id: input.spotId }, include: { vehicle: true } });
      if (target.vehicle && target.vehicle.id !== input.vehicleId) throw new Error(`区画${target.code}は使用中です`);
      const updated = await prisma.vehicle.updateMany({ where: { id: input.vehicleId, version: input.version }, data: { parkingSpotId: input.spotId, version: { increment: 1 } } });
      if (updated.count !== 1) throw new Error("CONFLICT");
      await prisma.auditLog.create({ data: { actorName: input.actorName, action: "駐車位置修正", targetType: "Vehicle", targetId: input.vehicleId, description: `区画${target.code}へ変更` } });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const duplicate = typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
    const employeeAction = input.action === "createEmployee" || input.action === "updateEmployee";
    const duplicateMessage = employeeAction ? "社員番号またはNFC UIDがすでに登録されています" : "車両番号・ナンバー・NFC UIDのいずれかがすでに登録されています";
    const message = duplicate ? duplicateMessage : error instanceof Error ? error.message : "更新に失敗しました";
    return NextResponse.json({ message: message === "CONFLICT" ? "他のユーザーが先に更新しました。最新状態を再読込しました。" : message }, { status: message === "CONFLICT" ? 409 : 400 });
  }
}
