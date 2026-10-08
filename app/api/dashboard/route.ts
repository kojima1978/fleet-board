import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { normalizeNfcUid } from "@/lib/nfc";
import { RESERVATION_GRACE_MINUTES } from "@/lib/reservations";
import { adminTokenFromRequest, verifyAdminToken } from "@/lib/admin-auth";
import { getBackupStatus } from "@/lib/backup-status";

export const dynamic = "force-dynamic";
const SAKURA_SPOT_CODE = "19";
const SAKURA_VEHICLE_CODE = "C07";
const activeOperationIds = new Set<string>();
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function withVehicleCode<T extends { id: string; name: string; plateNumber: string; color: string; hasEtc: boolean; hasNavigation: boolean; status: "AVAILABLE" | "RESERVED" | "IN_USE" | "MAINTENANCE"; parkingSpotId: string | null; active: boolean; version: number; vehicleNumber: { code: string }; nfcAssignments: { nfcTag: { uid: string } }[] }>(vehicle: T) {
  return { id: vehicle.id, code: vehicle.vehicleNumber.code, name: vehicle.name, plateNumber: vehicle.plateNumber, nfcUid: vehicle.nfcAssignments[0]?.nfcTag.uid ?? "", color: vehicle.color, hasEtc: vehicle.hasEtc, hasNavigation: vehicle.hasNavigation, status: vehicle.status, parkingSpotId: vehicle.parkingSpotId, active: vehicle.active, version: vehicle.version };
}

function withEmployeeCode<T extends { id: string; name: string; active: boolean; version: number; employeeNumber: { code: string }; department: { name: string }; nfcAssignments: { nfcTag: { uid: string } }[] }>(employee: T) {
  return { id: employee.id, code: employee.employeeNumber.code, name: employee.name, department: employee.department.name, nfcUid: employee.nfcAssignments[0]?.nfcTag.uid ?? "", active: employee.active, version: employee.version };
}

function todayInTokyo() {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const start = new Date(`${day}T00:00:00+09:00`);
  return { start, end: new Date(start.getTime() + 3 * 24 * 60 * 60_000) };
}

async function expireStaleReservations(now = new Date()) {
  const cutoff = new Date(now.getTime() - RESERVATION_GRACE_MINUTES * 60_000);
  const staleReservations = await prisma.trip.findMany({
    where: { status: "RESERVED", plannedStart: { lte: cutoff } },
    select: { id: true, version: true, employee: { select: { name: true } }, vehicle: { select: { name: true } } },
  });
  if (staleReservations.length === 0) return;
  await prisma.$transaction(async (tx) => {
    for (const reservation of staleReservations) {
      const updated = await tx.trip.updateMany({
        where: { id: reservation.id, version: reservation.version, status: "RESERVED" },
        data: { status: "CANCELLED", version: { increment: 1 } },
      });
      if (updated.count !== 1) continue;
      await tx.auditLog.create({
        data: {
          actorName: "システム",
          action: "予約自動取消",
          targetType: "Trip",
          targetId: reservation.id,
          description: `${reservation.vehicle.name}・${reservation.employee.name}の予約を開始${RESERVATION_GRACE_MINUTES}分経過のため自動取消`,
        },
      });
    }
  });
}

async function assertNfcAvailable(nfcUid: string, exclude?: { employeeId?: string; vehicleId?: string }) {
  const assignment = await prisma.nfcAssignment.findFirst({ where: { validTo: null, nfcTag: { uid: { equals: nfcUid, mode: "insensitive" } } }, select: { employeeId: true, vehicleId: true, employee: { select: { name: true } }, vehicle: { select: { name: true } } } });
  const ownedByExcludedEmployee = assignment?.employeeId === exclude?.employeeId;
  const ownedByExcludedVehicle = assignment?.vehicleId === exclude?.vehicleId;
  const owner = ownedByExcludedEmployee || ownedByExcludedVehicle ? undefined : assignment?.employee?.name ?? assignment?.vehicle?.name;
  if (owner) throw new Error(`このNFC UIDは「${owner}」で登録済みです`);
}

const nfcUidSchema = z.string().trim().min(1).max(100).transform(normalizeNfcUid);
const optionalNfcUidSchema = z.preprocess(
  (value) => value == null || (typeof value === "string" && !value.trim()) ? undefined : value,
  nfcUidSchema.optional(),
);
const actorSchema = { actorName: z.string(), actorEmployeeId: z.string().optional() };
const employeeImportItemSchema = z.object({ code: z.string().trim().min(1).max(20), name: z.string().trim().min(1).max(50), department: z.string().trim().min(1).max(50), nfcUid: optionalNfcUidSchema });
const vehicleImportItemSchema = z.object({ code: z.string().trim().min(1).max(20), name: z.string().trim().min(1).max(50), plateNumber: z.string().trim().min(1).max(30), nfcUid: optionalNfcUidSchema, color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#2563eb"), hasEtc: z.boolean().default(false), hasNavigation: z.boolean().default(false) });
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createEmployee"), code: z.string().trim().min(1).max(20), name: z.string().trim().min(1).max(50), department: z.string().trim().min(1).max(50), nfcUid: nfcUidSchema }),
  z.object({ action: z.literal("createVehicle"), code: z.string().trim().min(1).max(20), name: z.string().trim().min(1).max(50), plateNumber: z.string().trim().min(1).max(30), nfcUid: nfcUidSchema, color: z.string().regex(/^#[0-9a-fA-F]{6}$/), hasEtc: z.boolean().default(false), hasNavigation: z.boolean().default(false) }),
  z.object({ action: z.literal("updateEmployee"), id: z.string(), version: z.number().int(), name: z.string().trim().min(1).max(50), department: z.string().trim().min(1).max(50), nfcUid: nfcUidSchema }),
  z.object({ action: z.literal("updateVehicle"), id: z.string(), version: z.number().int(), name: z.string().trim().min(1).max(50), plateNumber: z.string().trim().min(1).max(30), nfcUid: nfcUidSchema, color: z.string().regex(/^#[0-9a-fA-F]{6}$/), hasEtc: z.boolean().optional(), hasNavigation: z.boolean().optional() }),
  z.object({ action: z.literal("setEmployeeActive"), id: z.string(), version: z.number().int(), active: z.boolean() }),
  z.object({ action: z.literal("setVehicleActive"), id: z.string(), version: z.number().int(), active: z.boolean() }),
  z.object({ action: z.literal("importEmployees"), items: z.array(employeeImportItemSchema).min(1).max(500) }),
  z.object({ action: z.literal("importVehicles"), items: z.array(vehicleImportItemSchema).min(1).max(500) }),
  z.object({ action: z.literal("start"), employeeId: z.string(), vehicleId: z.string(), minutes: z.number().int().min(15).max(10_080), ...actorSchema }),
  z.object({ action: z.literal("reserve"), employeeId: z.string(), vehicleId: z.string(), plannedStart: z.string().datetime(), minutes: z.number().int().min(15).max(10_080), ...actorSchema }),
  z.object({ action: z.literal("end"), tripId: z.string(), tripVersion: z.number().int(), vehicleId: z.string(), vehicleVersion: z.number().int(), spotId: z.string(), ...actorSchema }),
  z.object({ action: z.literal("undoReturn"), tripId: z.string(), vehicleId: z.string(), ...actorSchema }),
  z.object({ action: z.literal("moveTrip"), tripId: z.string(), version: z.number().int(), plannedStart: z.string().datetime(), plannedEnd: z.string().datetime(), ...actorSchema }),
  z.object({ action: z.literal("adjustTrip"), tripId: z.string(), version: z.number().int(), minutes: z.union([z.literal(-60), z.literal(-30), z.literal(-15), z.literal(15), z.literal(30), z.literal(60), z.literal(180), z.literal(300)]), ...actorSchema }),
  z.object({ action: z.literal("setTripEnd"), tripId: z.string(), version: z.number().int(), plannedEnd: z.string().datetime(), ...actorSchema }),
  z.object({ action: z.literal("cancelTrip"), tripId: z.string(), version: z.number().int(), ...actorSchema }),
  z.object({ action: z.literal("moveVehicle"), vehicleId: z.string(), version: z.number().int(), spotId: z.string(), ...actorSchema }),
]);
const adminActions = new Set(["createEmployee", "createVehicle", "updateEmployee", "updateVehicle", "setEmployeeActive", "setVehicleActive", "importEmployees", "importVehicles"]);

export async function GET(request: Request) {
  await expireStaleReservations();
  const defaults = todayInTokyo();
  const url = new URL(request.url);
  const requestedStart = url.searchParams.get("from");
  const parsedStart = requestedStart ? new Date(requestedStart) : defaults.start;
  const dayStart = Number.isNaN(parsedStart.getTime()) ? defaults.start : parsedStart;
  const requestedDays = Number(url.searchParams.get("days"));
  const days = requestedDays === 1 || requestedDays === 3 ? requestedDays : 3;
  const dayEnd = new Date(dayStart.getTime() + days * 24 * 60 * 60_000);
  const [employees, departments, vehicles, spots, trips, backup] = await Promise.all([
    prisma.employee.findMany({ include: { employeeNumber: true, department: true, nfcAssignments: { include: { nfcTag: true }, orderBy: { validFrom: "desc" }, take: 1 } }, orderBy: { employeeNumber: { code: "asc" } } }),
    prisma.department.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.vehicle.findMany({ include: { vehicleNumber: true, nfcAssignments: { include: { nfcTag: true }, orderBy: { validFrom: "desc" }, take: 1 } }, orderBy: { vehicleNumber: { code: "asc" } } }),
    prisma.parkingSpot.findMany({ include: { vehicle: { include: { vehicleNumber: true, nfcAssignments: { include: { nfcTag: true }, orderBy: { validFrom: "desc" }, take: 1 } } } }, orderBy: { code: "asc" } }),
    prisma.trip.findMany({
      where: { OR: [
        { status: "RESERVED", plannedStart: { lt: dayEnd }, plannedEnd: { gt: dayStart } },
        { status: "IN_USE" },
        { status: "COMPLETED", actualStart: { lt: dayEnd }, actualEnd: { gt: dayStart } },
        { status: "COMPLETED", actualEnd: null, plannedStart: { lt: dayEnd }, plannedEnd: { gt: dayStart } },
      ] },
      include: { employee: { include: { employeeNumber: true, department: true, nfcAssignments: { include: { nfcTag: true }, orderBy: { validFrom: "desc" }, take: 1 } } }, vehicle: { include: { vehicleNumber: true, nfcAssignments: { include: { nfcTag: true }, orderBy: { validFrom: "desc" }, take: 1 } } } }, orderBy: { plannedStart: "asc" },
    }),
    getBackupStatus(),
  ]);
  return NextResponse.json({
    employees: employees.map(withEmployeeCode),
    departments,
    vehicles: vehicles.map(withVehicleCode),
    spots: spots.map((spot) => ({ ...spot, vehicle: spot.vehicle ? withVehicleCode(spot.vehicle) : null })),
    trips: trips.map((trip) => ({ ...trip, employee: withEmployeeCode(trip.employee), vehicle: withVehicleCode(trip.vehicle) })),
    system: {
      backupLatestAt: backup.latestAt,
      backupVerifiedAt: backup.verifiedAt,
      appVersion: process.env.FLEETFLOW_APP_VERSION || "development",
      environment: process.env.NODE_ENV || "development",
      deployedAt: process.env.FLEETFLOW_DEPLOYED_AT || null,
    },
  });
}

export async function POST(request: Request) {
  const body = await request.json();
  const operationIdResult = z.string().uuid().safeParse(body?.operationId);
  if (!operationIdResult.success) return NextResponse.json({ message: "操作IDを確認できません。画面を更新して再試行してください" }, { status: 400 });
  const operationId = operationIdResult.data;
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ message: "入力内容を確認してください", details: process.env.NODE_ENV === "development" ? parsed.error.issues : undefined }, { status: 400 });
  const input = parsed.data;
  if (adminActions.has(input.action) && !verifyAdminToken(adminTokenFromRequest(request))) return NextResponse.json({ message: "管理者認証の有効期限が切れました。PINを再入力してください" }, { status: 401 });
  if (activeOperationIds.has(operationId)) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      await wait(100);
      const completed = await prisma.auditLog.findUnique({ where: { operationId }, select: { id: true } });
      if (completed) return NextResponse.json({ ok: true, replayed: true });
      if (!activeOperationIds.has(operationId)) break;
    }
    return NextResponse.json({ message: "同じ操作を処理中です。最新状態を再読込してください" }, { status: 409 });
  }
  activeOperationIds.add(operationId);
  try {
    const completed = await prisma.auditLog.findUnique({ where: { operationId }, select: { id: true } });
    if (completed) return NextResponse.json({ ok: true, replayed: true });
    await expireStaleReservations();
    if (input.action === "createEmployee") {
      await assertNfcAvailable(input.nfcUid);
      await prisma.$transaction(async (tx) => {
        const employeeNumber = await tx.employeeNumber.upsert({ where: { code: input.code }, update: {}, create: { code: input.code } });
        const department = await tx.department.upsert({ where: { name: input.department }, update: { active: true }, create: { name: input.department } });
        const assigned = await tx.employee.findFirst({ where: { employeeNumberId: employeeNumber.id, active: true }, select: { name: true } });
        if (assigned) throw new Error(`社員番号${input.code}は「${assigned.name}」で使用中です。旧社員を無効化してから登録してください`);
        const employee = await tx.employee.create({ data: { employeeNumberId: employeeNumber.id, departmentId: department.id, name: input.name } });
        const nfcTag = await tx.nfcTag.upsert({ where: { uid: input.nfcUid }, update: {}, create: { uid: input.nfcUid } });
        await tx.nfcAssignment.create({ data: { employeeId: employee.id, nfcTagId: nfcTag.id } });
        await tx.auditLog.create({ data: { operationId, actorName: "設定画面", action: "社員登録", targetType: "Employee", targetId: employee.id, description: `${input.code} ${employee.name}を登録` } });
      });
    }
    if (input.action === "createVehicle") {
      await assertNfcAvailable(input.nfcUid);
      await prisma.$transaction(async (tx) => {
        const vehicleNumber = await tx.vehicleNumber.upsert({ where: { code: input.code }, update: {}, create: { code: input.code } });
        const assigned = await tx.vehicle.findFirst({ where: { vehicleNumberId: vehicleNumber.id, active: true }, select: { name: true } });
        if (assigned) throw new Error(`車両番号${input.code}は「${assigned.name}」で使用中です。旧車両を無効化してから登録してください`);
        const vehicle = await tx.vehicle.create({ data: { vehicleNumberId: vehicleNumber.id, name: input.name, plateNumber: input.plateNumber, color: input.color, hasEtc: input.hasEtc, hasNavigation: input.hasNavigation } });
        const nfcTag = await tx.nfcTag.upsert({ where: { uid: input.nfcUid }, update: {}, create: { uid: input.nfcUid } });
        await tx.nfcAssignment.create({ data: { vehicleId: vehicle.id, nfcTagId: nfcTag.id } });
        await tx.auditLog.create({ data: { operationId, actorName: "設定画面", action: "車両登録", targetType: "Vehicle", targetId: vehicle.id, description: `${input.code} ${vehicle.name}を登録` } });
      });
    }
    if (input.action === "updateEmployee") {
      await assertNfcAvailable(input.nfcUid, { employeeId: input.id });
      await prisma.$transaction(async (tx) => {
        const employee = await tx.employee.findUniqueOrThrow({ where: { id: input.id }, include: { nfcAssignments: { where: { validTo: null }, include: { nfcTag: true }, take: 1 } } });
        const department = await tx.department.upsert({ where: { name: input.department }, update: { active: true }, create: { name: input.department } });
        const updated = await tx.employee.updateMany({ where: { id: input.id, version: input.version }, data: { name: input.name, departmentId: department.id, version: { increment: 1 } } });
        if (updated.count !== 1) throw new Error("CONFLICT");
        const currentUid = employee.nfcAssignments[0]?.nfcTag.uid;
        if (currentUid !== input.nfcUid) {
          if (!employee.active) throw new Error("無効な社員のNFCカードは変更できません。先に社員を再有効化してください");
          const changedAt = new Date();
          await tx.nfcAssignment.updateMany({ where: { employeeId: employee.id, validTo: null }, data: { validTo: changedAt } });
          const nfcTag = await tx.nfcTag.upsert({ where: { uid: input.nfcUid }, update: {}, create: { uid: input.nfcUid } });
          await tx.nfcAssignment.create({ data: { employeeId: employee.id, nfcTagId: nfcTag.id, validFrom: changedAt } });
        }
        await tx.auditLog.create({ data: { operationId, actorName: "設定画面", action: "社員情報修正", targetType: "Employee", targetId: input.id, description: `${input.name}の登録情報を修正` } });
      });
    }
    if (input.action === "updateVehicle") {
      await assertNfcAvailable(input.nfcUid, { vehicleId: input.id });
      await prisma.$transaction(async (tx) => {
        const vehicle = await tx.vehicle.findUniqueOrThrow({ where: { id: input.id }, include: { nfcAssignments: { where: { validTo: null }, include: { nfcTag: true }, take: 1 } } });
        const updated = await tx.vehicle.updateMany({ where: { id: input.id, version: input.version }, data: { name: input.name, plateNumber: input.plateNumber, color: input.color, ...(input.hasEtc === undefined ? {} : { hasEtc: input.hasEtc }), ...(input.hasNavigation === undefined ? {} : { hasNavigation: input.hasNavigation }), version: { increment: 1 } } });
        if (updated.count !== 1) throw new Error("CONFLICT");
        const currentUid = vehicle.nfcAssignments[0]?.nfcTag.uid;
        if (currentUid !== input.nfcUid) {
          if (!vehicle.active) throw new Error("無効な車両のNFCタグは変更できません。先に車両を再有効化してください");
          const changedAt = new Date();
          await tx.nfcAssignment.updateMany({ where: { vehicleId: vehicle.id, validTo: null }, data: { validTo: changedAt } });
          const nfcTag = await tx.nfcTag.upsert({ where: { uid: input.nfcUid }, update: {}, create: { uid: input.nfcUid } });
          await tx.nfcAssignment.create({ data: { vehicleId: vehicle.id, nfcTagId: nfcTag.id, validFrom: changedAt } });
        }
        await tx.auditLog.create({ data: { operationId, actorName: "設定画面", action: "車両情報修正", targetType: "Vehicle", targetId: input.id, description: `${input.name}の登録情報を修正` } });
      });
    }
    if (input.action === "setEmployeeActive") {
      await prisma.$transaction(async (tx) => {
        const employee = await tx.employee.findUniqueOrThrow({ where: { id: input.id }, include: { nfcAssignments: { include: { nfcTag: true }, orderBy: { validFrom: "desc" }, take: 1 } } });
        if (!input.active) {
          const activeTrip = await tx.trip.findFirst({ where: { employeeId: input.id, status: { in: ["RESERVED", "IN_USE"] } } });
          if (activeTrip) throw new Error("利用中または予約中の社員は無効化できません");
        }
        if (input.active) {
          const assigned = await tx.employee.findFirst({ where: { employeeNumberId: employee.employeeNumberId, active: true, id: { not: employee.id } }, select: { name: true } });
          if (assigned) throw new Error(`この社員番号は「${assigned.name}」で使用中のため再有効化できません`);
          const latestTag = employee.nfcAssignments[0]?.nfcTag;
          if (!latestTag) throw new Error("再有効化に使用できるNFCカード履歴がありません");
          const cardOwner = await tx.nfcAssignment.findFirst({ where: { nfcTagId: latestTag.id, validTo: null }, select: { employee: { select: { name: true } }, vehicle: { select: { name: true } } } });
          const owner = cardOwner?.employee?.name ?? cardOwner?.vehicle?.name;
          if (owner) throw new Error(`以前のNFCカードは「${owner}」で使用中です。別のカードで新規登録してください`);
          await tx.nfcAssignment.create({ data: { employeeId: employee.id, nfcTagId: latestTag.id } });
        }
        const updated = await tx.employee.updateMany({ where: { id: input.id, version: input.version }, data: { active: input.active, version: { increment: 1 } } });
        if (updated.count !== 1) throw new Error("CONFLICT");
        if (!input.active) await tx.nfcAssignment.updateMany({ where: { employeeId: employee.id, validTo: null }, data: { validTo: new Date() } });
        await tx.auditLog.create({ data: { operationId, actorName: "設定画面", action: input.active ? "社員再有効化" : "社員無効化", targetType: "Employee", targetId: input.id, description: input.active ? "社員を再有効化" : "社員を無効化" } });
      });
    }
    if (input.action === "setVehicleActive") {
      await prisma.$transaction(async (tx) => {
        const vehicle = await tx.vehicle.findUniqueOrThrow({ where: { id: input.id }, include: { nfcAssignments: { include: { nfcTag: true }, orderBy: { validFrom: "desc" }, take: 1 } } });
        if (!input.active && vehicle.status !== "AVAILABLE") throw new Error("利用中または予約中の車両は無効化できません");
        if (input.active) {
          const assigned = await tx.vehicle.findFirst({ where: { vehicleNumberId: vehicle.vehicleNumberId, active: true, id: { not: vehicle.id } }, select: { name: true } });
          if (assigned) throw new Error(`この車両番号は「${assigned.name}」で使用中のため再有効化できません`);
          const latestTag = vehicle.nfcAssignments[0]?.nfcTag;
          if (!latestTag) throw new Error("再有効化に使用できるNFCタグ履歴がありません");
          const tagOwner = await tx.nfcAssignment.findFirst({ where: { nfcTagId: latestTag.id, validTo: null }, select: { employee: { select: { name: true } }, vehicle: { select: { name: true } } } });
          const owner = tagOwner?.employee?.name ?? tagOwner?.vehicle?.name;
          if (owner) throw new Error(`以前のNFCタグは「${owner}」で使用中です。別のタグで新規登録してください`);
          await tx.nfcAssignment.create({ data: { vehicleId: vehicle.id, nfcTagId: latestTag.id } });
        }
        const updated = await tx.vehicle.updateMany({ where: { id: input.id, version: input.version }, data: { active: input.active, parkingSpotId: input.active ? vehicle.parkingSpotId : null, version: { increment: 1 } } });
        if (updated.count !== 1) throw new Error("CONFLICT");
        if (!input.active) await tx.nfcAssignment.updateMany({ where: { vehicleId: vehicle.id, validTo: null }, data: { validTo: new Date() } });
        await tx.auditLog.create({ data: { operationId, actorName: "設定画面", action: input.active ? "車両再有効化" : "車両無効化", targetType: "Vehicle", targetId: input.id, description: input.active ? "車両を再有効化" : "車両を無効化" } });
      });
    }
    if (input.action === "importEmployees") {
      const codes = new Set<string>();
      const nfcUids = new Set<string>();
      for (const item of input.items) {
        const codeKey = item.code.toLocaleUpperCase("ja");
        if (codes.has(codeKey)) throw new Error(`JSON内で社員番号${item.code}が重複しています`);
        codes.add(codeKey);
        if (item.nfcUid) {
          const nfcKey = item.nfcUid.toLocaleUpperCase("ja");
          if (nfcUids.has(nfcKey)) throw new Error(`JSON内でNFC UID ${item.nfcUid}が重複しています`);
          nfcUids.add(nfcKey);
        }
      }
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('fleet-import-employees'))::text AS import_lock`;
        if (await tx.auditLog.findUnique({ where: { operationId }, select: { id: true } })) return;
        for (const item of input.items) {
          const employeeNumber = await tx.employeeNumber.upsert({ where: { code: item.code }, update: {}, create: { code: item.code } });
          const existingEmployee = await tx.employee.findFirst({ where: { employeeNumberId: employeeNumber.id, active: true }, select: { name: true } });
          if (existingEmployee) throw new Error(`社員番号${item.code}は「${existingEmployee.name}」で使用中です`);
          if (item.nfcUid) {
            const existingNfc = await tx.nfcAssignment.findFirst({ where: { validTo: null, nfcTag: { uid: { equals: item.nfcUid, mode: "insensitive" } } }, select: { employee: { select: { name: true } }, vehicle: { select: { name: true } } } });
            const nfcOwner = existingNfc?.employee?.name ?? existingNfc?.vehicle?.name;
            if (nfcOwner) throw new Error(`NFC UID ${item.nfcUid}は「${nfcOwner}」で使用中です`);
          }
          const department = await tx.department.upsert({ where: { name: item.department }, update: { active: true }, create: { name: item.department } });
          const employee = await tx.employee.create({ data: { employeeNumberId: employeeNumber.id, departmentId: department.id, name: item.name } });
          if (item.nfcUid) {
            const nfcTag = await tx.nfcTag.upsert({ where: { uid: item.nfcUid }, update: {}, create: { uid: item.nfcUid } });
            await tx.nfcAssignment.create({ data: { employeeId: employee.id, nfcTagId: nfcTag.id } });
          }
        }
        await tx.auditLog.create({ data: { operationId, actorName: "設定画面", action: "社員JSON取込", targetType: "Employee", targetId: "bulk", description: `${input.items.length}人をJSONから一括登録` } });
      });
    }
    if (input.action === "importVehicles") {
      const codes = new Set<string>();
      const plates = new Set<string>();
      const nfcUids = new Set<string>();
      for (const item of input.items) {
        const codeKey = item.code.toLocaleUpperCase("ja");
        const plateKey = item.plateNumber.replace(/\s/g, "").toLocaleUpperCase("ja");
        if (codes.has(codeKey)) throw new Error(`JSON内で車両番号${item.code}が重複しています`);
        if (plates.has(plateKey)) throw new Error(`JSON内でナンバー${item.plateNumber}が重複しています`);
        codes.add(codeKey); plates.add(plateKey);
        if (item.nfcUid) {
          const nfcKey = item.nfcUid.toLocaleUpperCase("ja");
          if (nfcUids.has(nfcKey)) throw new Error(`JSON内でNFC UID ${item.nfcUid}が重複しています`);
          nfcUids.add(nfcKey);
        }
      }
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('fleet-import-vehicles'))::text AS import_lock`;
        if (await tx.auditLog.findUnique({ where: { operationId }, select: { id: true } })) return;
        for (const item of input.items) {
          const vehicleNumber = await tx.vehicleNumber.upsert({ where: { code: item.code }, update: {}, create: { code: item.code } });
          const existingVehicle = await tx.vehicle.findFirst({ where: { vehicleNumberId: vehicleNumber.id, active: true }, select: { name: true } });
          if (existingVehicle) throw new Error(`車両番号${item.code}は「${existingVehicle.name}」で使用中です`);
          const existingPlate = await tx.vehicle.findUnique({ where: { plateNumber: item.plateNumber }, select: { name: true } });
          if (existingPlate) throw new Error(`ナンバー${item.plateNumber}は「${existingPlate.name}」で登録済みです`);
          if (item.nfcUid) {
            const existingNfc = await tx.nfcAssignment.findFirst({ where: { validTo: null, nfcTag: { uid: { equals: item.nfcUid, mode: "insensitive" } } }, select: { employee: { select: { name: true } }, vehicle: { select: { name: true } } } });
            const nfcOwner = existingNfc?.employee?.name ?? existingNfc?.vehicle?.name;
            if (nfcOwner) throw new Error(`NFC UID ${item.nfcUid}は「${nfcOwner}」で使用中です`);
          }
          const vehicle = await tx.vehicle.create({ data: { vehicleNumberId: vehicleNumber.id, name: item.name, plateNumber: item.plateNumber, color: item.color, hasEtc: item.hasEtc, hasNavigation: item.hasNavigation } });
          if (item.nfcUid) {
            const nfcTag = await tx.nfcTag.upsert({ where: { uid: item.nfcUid }, update: {}, create: { uid: item.nfcUid } });
            await tx.nfcAssignment.create({ data: { vehicleId: vehicle.id, nfcTagId: nfcTag.id } });
          }
        }
        await tx.auditLog.create({ data: { operationId, actorName: "設定画面", action: "車両JSON取込", targetType: "Vehicle", targetId: "bulk", description: `${input.items.length}台をJSONから一括登録` } });
      });
    }
    if (input.action === "start") {
      const now = new Date();
      const plannedEnd = new Date(now.getTime() + input.minutes * 60_000);
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`fleet-employee:${input.employeeId}`}))::text AS employee_lock, pg_advisory_xact_lock(hashtext(${`fleet-vehicle:${input.vehicleId}`}))::text AS vehicle_lock`;
        const [vehicle, employee] = await Promise.all([tx.vehicle.findUniqueOrThrow({ where: { id: input.vehicleId } }), tx.employee.findUniqueOrThrow({ where: { id: input.employeeId } })]);
        if (!vehicle.active || vehicle.status !== "AVAILABLE") throw new Error("この車両は現在利用できません");
        if (!employee.active) throw new Error("この社員は現在利用できません");
        const reservation = await tx.trip.findFirst({
          where: { vehicleId: vehicle.id, status: "RESERVED", plannedStart: { lt: plannedEnd }, plannedEnd: { gt: now } },
          include: { employee: true },
          orderBy: { plannedStart: "asc" },
        });
        if (reservation && reservation.employeeId !== employee.id) throw new Error(`${reservation.employee.name}さんの予約時間と重なっています`);
        const employeeConflict = await tx.trip.findFirst({
          where: {
            employeeId: employee.id,
            id: reservation ? { not: reservation.id } : undefined,
            OR: [
              { status: "IN_USE" },
              { status: "RESERVED", plannedStart: { lt: plannedEnd }, plannedEnd: { gt: now } },
            ],
          },
          include: { vehicle: true },
        });
        if (employeeConflict) throw new Error(`${employee.name}さんは${employeeConflict.vehicle.name}を利用中または予約中です`);
        const updated = await tx.vehicle.updateMany({ where: { id: vehicle.id, version: vehicle.version }, data: { status: "IN_USE", parkingSpotId: null, version: { increment: 1 } } });
        if (updated.count !== 1) throw new Error("CONFLICT");
        if (reservation) {
          await tx.trip.update({ where: { id: reservation.id }, data: { status: "IN_USE", actualStart: now, version: { increment: 1 } } });
        } else {
          await tx.trip.create({ data: { employeeId: input.employeeId, vehicleId: input.vehicleId, plannedStart: now, plannedEnd, actualStart: now, status: "IN_USE", purpose: "" } });
        }
        await tx.auditLog.create({ data: { operationId, actorEmployeeId: input.actorEmployeeId, actorName: input.actorName, action: "利用開始", targetType: "Vehicle", targetId: input.vehicleId, description: reservation ? "予約から利用を開始" : `${input.minutes}分の利用を開始` } });
      });
    }
    if (input.action === "reserve") {
      const now = new Date();
      const plannedStart = new Date(input.plannedStart);
      const plannedEnd = new Date(plannedStart.getTime() + input.minutes * 60_000);
      if (plannedStart <= now) throw new Error("開始予定は現在時刻より後にしてください");
      if (plannedStart.getTime() > now.getTime() + 7 * 24 * 60 * 60_000) throw new Error("予約できるのは7日後までです");
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`fleet-employee:${input.employeeId}`}))::text AS employee_lock, pg_advisory_xact_lock(hashtext(${`fleet-vehicle:${input.vehicleId}`}))::text AS vehicle_lock`;
        const [vehicle, employee] = await Promise.all([tx.vehicle.findUniqueOrThrow({ where: { id: input.vehicleId } }), tx.employee.findUniqueOrThrow({ where: { id: input.employeeId } })]);
        if (!vehicle.active || vehicle.status !== "AVAILABLE") throw new Error("この車両は現在予約できません");
        if (!employee.active) throw new Error("この社員は現在予約できません");
        const conflict = await tx.trip.findFirst({
          where: {
            status: { in: ["RESERVED", "IN_USE"] },
            plannedStart: { lt: plannedEnd },
            plannedEnd: { gt: plannedStart },
            OR: [{ vehicleId: input.vehicleId }, { employeeId: input.employeeId }],
          },
          include: { employee: true, vehicle: true },
        });
        if (conflict) throw new Error(conflict.vehicleId === input.vehicleId ? `${conflict.vehicle.name}は指定時間に利用予定があります` : `${conflict.employee.name}さんは指定時間に別の予定があります`);
        const trip = await tx.trip.create({ data: { employeeId: input.employeeId, vehicleId: input.vehicleId, plannedStart, plannedEnd, status: "RESERVED", purpose: "" } });
        await tx.auditLog.create({ data: { operationId, actorEmployeeId: input.actorEmployeeId, actorName: input.actorName, action: "予約登録", targetType: "Trip", targetId: trip.id, description: `${input.minutes}分の利用予定を登録` } });
      });
    }
    if (input.action === "end") {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`fleet-spot:${input.spotId}`}))::text AS spot_lock, pg_advisory_xact_lock(hashtext(${`fleet-vehicle:${input.vehicleId}`}))::text AS vehicle_lock`;
        const [target, returningVehicle] = await Promise.all([
          tx.parkingSpot.findUniqueOrThrow({ where: { id: input.spotId }, include: { vehicle: true } }),
          tx.vehicle.findUniqueOrThrow({ where: { id: input.vehicleId }, select: { vehicleNumber: { select: { code: true } } } }),
        ]);
        if (target.vehicle && target.vehicle.id !== input.vehicleId) throw new Error(`区画${target.code}は使用中です`);
        if (target.code === SAKURA_SPOT_CODE && returningVehicle.vehicleNumber.code !== SAKURA_VEHICLE_CODE) throw new Error("区画19はサクラ専用です");
        const trip = await tx.trip.updateMany({ where: { id: input.tripId, vehicleId: input.vehicleId, version: input.tripVersion, status: "IN_USE" }, data: { status: "COMPLETED", actualEnd: new Date(), returnSpotCode: target.code, version: { increment: 1 } } });
        const vehicle = await tx.vehicle.updateMany({ where: { id: input.vehicleId, version: input.vehicleVersion }, data: { status: "AVAILABLE", parkingSpotId: input.spotId, version: { increment: 1 } } });
        if (trip.count !== 1 || vehicle.count !== 1) throw new Error("CONFLICT");
        await tx.auditLog.create({ data: { operationId, actorEmployeeId: input.actorEmployeeId, actorName: input.actorName, action: "返却", targetType: "Trip", targetId: input.tripId, description: `区画${target.code}へ返却` } });
      });
    }
    if (input.action === "undoReturn") {
      const now = new Date();
      await prisma.$transaction(async (tx) => {
        const trip = await tx.trip.findUniqueOrThrow({ where: { id: input.tripId }, include: { vehicle: true, employee: true } });
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`fleet-employee:${trip.employeeId}`}))::text AS employee_lock, pg_advisory_xact_lock(hashtext(${`fleet-vehicle:${trip.vehicleId}`}))::text AS vehicle_lock`;
        if (trip.vehicleId !== input.vehicleId || trip.status !== "COMPLETED" || !trip.actualEnd) throw new Error("この返却記録は取り消せません");
        if (now.getTime() - trip.actualEnd.getTime() > 5 * 60_000) throw new Error("返却から5分を過ぎたため、画面からは取り消せません");
        const [vehicle, employeeConflict, subsequentTrip, laterVehicleAction] = await Promise.all([
          tx.vehicle.findUniqueOrThrow({ where: { id: trip.vehicleId } }),
          tx.trip.findFirst({ where: { employeeId: trip.employeeId, status: "IN_USE" } }),
          tx.trip.findFirst({ where: { id: { not: trip.id }, vehicleId: trip.vehicleId, actualStart: { gt: trip.actualEnd } } }),
          tx.auditLog.findFirst({ where: { targetType: "Vehicle", targetId: trip.vehicleId, createdAt: { gt: trip.actualEnd } } }),
        ]);
        if (vehicle.status !== "AVAILABLE" || employeeConflict || subsequentTrip || laterVehicleAction) throw new Error("返却後に車両または利用者の状態が変更されたため取り消せません");
        const restoredTrip = await tx.trip.updateMany({ where: { id: trip.id, status: "COMPLETED", version: trip.version }, data: { status: "IN_USE", actualEnd: null, returnSpotCode: null, version: { increment: 1 } } });
        const restoredVehicle = await tx.vehicle.updateMany({ where: { id: vehicle.id, status: "AVAILABLE", version: vehicle.version }, data: { status: "IN_USE", parkingSpotId: null, version: { increment: 1 } } });
        if (restoredTrip.count !== 1 || restoredVehicle.count !== 1) throw new Error("CONFLICT");
        await tx.auditLog.create({ data: { operationId, actorEmployeeId: input.actorEmployeeId, actorName: input.actorName, action: "返却取消", targetType: "Trip", targetId: trip.id, description: `${trip.vehicle.name}の返却を取り消して利用中へ復元` } });
      });
    }
    if (input.action === "moveTrip") {
      await prisma.$transaction(async (tx) => {
        const trip = await tx.trip.findUniqueOrThrow({ where: { id: input.tripId } });
        if (trip.status !== "RESERVED") throw new Error("ドラッグで移動できるのは予約だけです");
        const plannedStart = new Date(input.plannedStart);
        const plannedEnd = new Date(input.plannedEnd);
        if (plannedEnd <= plannedStart) throw new Error("終了時刻は開始時刻より後にしてください");
        const conflict = await tx.trip.findFirst({ where: {
          id: { not: trip.id },
          OR: [
            { status: "IN_USE", OR: [{ vehicleId: trip.vehicleId }, { employeeId: trip.employeeId }] },
            { status: "RESERVED", plannedStart: { lt: plannedEnd }, plannedEnd: { gt: plannedStart }, OR: [{ vehicleId: trip.vehicleId }, { employeeId: trip.employeeId }] },
          ],
        } });
        if (conflict) throw new Error("車両または利用者の予定と重なっています");
        const updated = await tx.trip.updateMany({ where: { id: trip.id, version: input.version, status: "RESERVED" }, data: { plannedStart, plannedEnd, version: { increment: 1 } } });
        if (updated.count !== 1) throw new Error("CONFLICT");
        await tx.auditLog.create({ data: { operationId, actorEmployeeId: input.actorEmployeeId, actorName: input.actorName, action: "利用時間修正", targetType: "Trip", targetId: trip.id, description: "タイムラインから時間を変更" } });
      });
    }
    if (input.action === "adjustTrip") {
      await prisma.$transaction(async (tx) => {
        const trip = await tx.trip.findUniqueOrThrow({ where: { id: input.tripId } });
        if (trip.status !== "RESERVED" && trip.status !== "IN_USE") throw new Error("完了・取消済みの予定時間は変更できません");
        const newEnd = new Date(trip.plannedEnd.getTime() + input.minutes * 60_000);
        const minimumEnd = new Date(trip.plannedStart.getTime() + 15 * 60_000);
        const maximumEnd = new Date(trip.plannedStart.getTime() + 7 * 24 * 60 * 60_000);
        if (newEnd < minimumEnd) throw new Error("利用時間は15分未満にできません");
        if (newEnd > maximumEnd) throw new Error("利用期間は開始から7日以内で指定してください");
        if (trip.status === "IN_USE" && newEnd < new Date()) throw new Error("利用中の終了予定を現在時刻より前にはできません");
        if (input.minutes > 0) {
          const overlap = await tx.trip.findFirst({ where: {
            id: { not: trip.id },
            OR: [
              { status: "IN_USE", OR: [{ vehicleId: trip.vehicleId }, { employeeId: trip.employeeId }] },
              { status: "RESERVED", plannedStart: { lt: newEnd }, plannedEnd: { gt: trip.plannedEnd }, OR: [{ vehicleId: trip.vehicleId }, { employeeId: trip.employeeId }] },
            ],
          } });
          if (overlap) throw new Error("延長時間が車両または利用者の予定と重なります");
        }
        const updated = await tx.trip.updateMany({ where: { id: trip.id, version: input.version }, data: { plannedEnd: newEnd, version: { increment: 1 } } });
        if (updated.count !== 1) throw new Error("CONFLICT");
        const direction = input.minutes > 0 ? "延長" : "短縮";
        await tx.auditLog.create({ data: { operationId, actorEmployeeId: input.actorEmployeeId, actorName: input.actorName, action: `利用時間${direction}`, targetType: "Trip", targetId: trip.id, description: `${Math.abs(input.minutes)}分${direction}` } });
      });
    }
    if (input.action === "setTripEnd") {
      await prisma.$transaction(async (tx) => {
        const trip = await tx.trip.findUniqueOrThrow({ where: { id: input.tripId } });
        if (trip.status !== "RESERVED" && trip.status !== "IN_USE") throw new Error("完了・取消済みの予定時間は変更できません");
        const newEnd = new Date(input.plannedEnd);
        const minimumEnd = new Date(trip.plannedStart.getTime() + 15 * 60_000);
        const maximumEnd = new Date(trip.plannedStart.getTime() + 7 * 24 * 60 * 60_000);
        if (newEnd < minimumEnd) throw new Error("利用時間は15分未満にできません");
        if (newEnd > maximumEnd) throw new Error("利用期間は開始から7日以内で指定してください");
        if (trip.status === "IN_USE" && newEnd < new Date()) throw new Error("利用中の終了予定を現在時刻より前にはできません");
        if (newEnd > trip.plannedEnd) {
          const sameVehicleOrEmployee = [{ vehicleId: trip.vehicleId }, { employeeId: trip.employeeId }];
          const overlap = await tx.trip.findFirst({ where: {
            id: { not: trip.id },
            OR: [
              { status: "IN_USE", OR: sameVehicleOrEmployee },
              { status: "RESERVED", plannedStart: { lt: newEnd }, plannedEnd: { gt: trip.plannedStart }, OR: sameVehicleOrEmployee },
            ],
          } });
          if (overlap) throw new Error("指定した終了日時が車両または利用者の予定と重なります");
        }
        const updated = await tx.trip.updateMany({ where: { id: trip.id, version: input.version, status: trip.status }, data: { plannedEnd: newEnd, version: { increment: 1 } } });
        if (updated.count !== 1) throw new Error("CONFLICT");
        await tx.auditLog.create({ data: { operationId, actorEmployeeId: input.actorEmployeeId, actorName: input.actorName, action: "利用終了日時変更", targetType: "Trip", targetId: trip.id, description: `${trip.plannedEnd.toISOString()}から${newEnd.toISOString()}へ変更` } });
      });
    }
    if (input.action === "cancelTrip") {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.trip.updateMany({ where: { id: input.tripId, version: input.version, status: "RESERVED" }, data: { status: "CANCELLED", version: { increment: 1 } } });
        if (updated.count !== 1) throw new Error("予約済みの予定だけ取り消せます");
        await tx.auditLog.create({ data: { operationId, actorEmployeeId: input.actorEmployeeId, actorName: input.actorName, action: "予約取消", targetType: "Trip", targetId: input.tripId, description: "タイムラインから予約を取り消し" } });
      });
    }
    if (input.action === "moveVehicle") {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`fleet-spot:${input.spotId}`}))::text AS spot_lock, pg_advisory_xact_lock(hashtext(${`fleet-vehicle:${input.vehicleId}`}))::text AS vehicle_lock`;
        const [target, movingVehicle] = await Promise.all([
          tx.parkingSpot.findUniqueOrThrow({ where: { id: input.spotId }, include: { vehicle: true } }),
          tx.vehicle.findUniqueOrThrow({ where: { id: input.vehicleId }, select: { status: true, vehicleNumber: { select: { code: true } } } }),
        ]);
        if (movingVehicle.status !== "AVAILABLE") throw new Error("利用中の車両には駐車位置を設定できません");
        if (target.vehicle && target.vehicle.id !== input.vehicleId) throw new Error(`区画${target.code}は使用中です`);
        if (target.code === SAKURA_SPOT_CODE && movingVehicle.vehicleNumber.code !== SAKURA_VEHICLE_CODE) throw new Error("区画19はサクラ専用です");
        const updated = await tx.vehicle.updateMany({ where: { id: input.vehicleId, version: input.version }, data: { parkingSpotId: input.spotId, version: { increment: 1 } } });
        if (updated.count !== 1) throw new Error("CONFLICT");
        await tx.auditLog.create({ data: { operationId, actorEmployeeId: input.actorEmployeeId, actorName: input.actorName, action: "駐車位置修正", targetType: "Vehicle", targetId: input.vehicleId, description: `区画${target.code}へ変更` } });
      });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const duplicate = typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
    if (duplicate) {
      const completed = await prisma.auditLog.findUnique({ where: { operationId }, select: { id: true } });
      if (completed) return NextResponse.json({ ok: true, replayed: true });
    }
    const employeeAction = input.action === "createEmployee" || input.action === "updateEmployee" || input.action === "importEmployees";
    const duplicateMessage = employeeAction ? "社員番号またはNFC UIDがすでに登録されています" : "車両番号・ナンバー・NFC UIDのいずれかがすでに登録されています";
    const message = duplicate ? duplicateMessage : error instanceof Error ? error.message : "更新に失敗しました";
    return NextResponse.json({ message: message === "CONFLICT" ? "他のユーザーが先に更新しました。最新状態を再読込しました。" : message }, { status: message === "CONFLICT" ? 409 : 400 });
  } finally {
    activeOperationIds.delete(operationId);
  }
}
