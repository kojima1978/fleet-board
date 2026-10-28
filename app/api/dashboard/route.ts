import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { normalizeNfcUid } from "@/lib/nfc";
import { RESERVATION_GRACE_MINUTES } from "@/lib/reservations";
import { FUEL_LEVEL_MAX, formatFuelLevel } from "@/lib/fuel-level";
import { getBackupStatus } from "@/lib/backup-status";
import { isSameOriginRequest, readJsonBody } from "@/lib/request-security";
import { getApplicationSystemStatus } from "@/lib/system-status";
import { canUseSpot, formatSpotLabel, PARKING_SPOT_ROLES, SPOT_LABEL_MAX_LENGTH, SPOT_ROLE_LABELS } from "@/lib/parking-spots";
import { isRecordCode, normalizeRecordCode, recordCodeMessage } from "@/lib/record-codes";
import { formatMaintenanceTime, MAINTENANCE_KIND_SHORT_LABELS, MAINTENANCE_KINDS, MAINTENANCE_MAX_DAYS, MAINTENANCE_NOTE_MAX, MAINTENANCE_SCHEDULE_DAYS_AHEAD, maintenanceConflictMessage } from "@/lib/maintenance";
import { createQrToken, qrPayload } from "@/lib/qr-code";
import { updateTripStart } from "@/lib/trip-time-actions";
import { captureTripStartSnapshot } from "@/lib/trip-snapshot";
import type { Prisma } from "@/prisma/generated/client";

export const dynamic = "force-dynamic";
const activeOperationIds = new Set<string>();
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

type LatestNfcAssignment = { cleared: boolean; nfcTag: { id: string; uid: string } };

// 最新の割り当て（利用停止中は再開で戻すカード）。UIDを消して外したものは戻さない。
function restorableNfcTag(assignments: LatestNfcAssignment[]) {
  const latest = assignments[0];
  return latest && !latest.cleared ? latest.nfcTag : undefined;
}

function withVehicleCode<T extends { id: string; name: string; qrToken: string; plateNumber: string; color: string; hasEtc: boolean; hasNavigation: boolean; fuelLevel: number | null; status: "AVAILABLE" | "RESERVED" | "IN_USE" | "MAINTENANCE"; parkingSpotId: string | null; active: boolean; version: number; vehicleNumber: { code: string }; nfcAssignments: LatestNfcAssignment[] }>(vehicle: T) {
  return { id: vehicle.id, code: vehicle.vehicleNumber.code, name: vehicle.name, plateNumber: vehicle.plateNumber, nfcUid: restorableNfcTag(vehicle.nfcAssignments)?.uid ?? "", qrCode: qrPayload("vehicle", vehicle.qrToken), color: vehicle.color, hasEtc: vehicle.hasEtc, hasNavigation: vehicle.hasNavigation, fuelLevel: vehicle.fuelLevel, status: vehicle.status, parkingSpotId: vehicle.parkingSpotId, active: vehicle.active, version: vehicle.version };
}

function withEmployeeCode<T extends { id: string; name: string; email: string | null; qrToken: string; active: boolean; version: number; employeeNumber: { code: string }; department: { name: string }; nfcAssignments: LatestNfcAssignment[] }>(employee: T) {
  return { id: employee.id, code: employee.employeeNumber.code, name: employee.name, email: employee.email ?? "", department: employee.department.name, nfcUid: restorableNfcTag(employee.nfcAssignments)?.uid ?? "", qrCode: qrPayload("employee", employee.qrToken), active: employee.active, version: employee.version };
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

// rowを渡すと、JSON取込の何件目かを添えて知らせる。
function assertRecordCode(code: string, kind: "employee" | "vehicle", row?: number) {
  if (!isRecordCode(code)) throw new Error(`${row ? `${row}件目の` : ""}${recordCodeMessage(kind)}`);
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
const optionalEmailSchema = z.preprocess(
  (value) => value == null || (typeof value === "string" && !value.trim()) ? undefined : value,
  z.string().trim().email("メールアドレスを確認してください").max(254).transform((value) => value.toLowerCase()).optional(),
);
const idSchema = z.string().trim().min(1).max(100);
// 形式（英字1文字＋数字3桁）は、どの項目が誤りかを伝えるため各処理で確かめる。DBの制約でも同じ形式に限る。
const recordCodeSchema = z.string().max(20).transform(normalizeRecordCode).pipe(z.string().min(1));
// 区画番号は配置図の小さな枠に出すため短くし、全角数字は半角へそろえる。
// 表示名は区画の枠に収まる長さにする。空欄なら用途から自動で決める。
const spotLabelSchema = z.string().transform((value) => value.normalize("NFKC").trim()).pipe(z.string().max(SPOT_LABEL_MAX_LENGTH, `表示名は${SPOT_LABEL_MAX_LENGTH}文字以内で入力してください`)).transform((value) => value || null);
const spotCodeSchema = z.string().transform((value) => value.normalize("NFKC").trim()).pipe(z.string().min(1, "区画番号を入力してください").max(12, "区画番号は12文字以内で入力してください").regex(/^\S+$/, "区画番号に空白は使えません"));
// 空白の違いで同じ部署が二重に登録されないよう、連続する空白を1つにまとめる。
const departmentNameSchema = z.string().trim().min(1).max(50).transform((value) => value.replace(/\s+/g, " "));
const actorSchema = { actorName: z.string().trim().max(50).optional(), actorEmployeeId: idSchema.optional() };
const employeeImportItemSchema = z.object({ code: recordCodeSchema, name: z.string().trim().min(1).max(50), email: optionalEmailSchema, department: departmentNameSchema, nfcUid: optionalNfcUidSchema });
const vehicleImportItemSchema = z.object({ code: recordCodeSchema, name: z.string().trim().min(1).max(50), plateNumber: z.string().trim().min(1).max(30), nfcUid: optionalNfcUidSchema, color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#2563eb"), hasEtc: z.boolean().default(false), hasNavigation: z.boolean().default(false), spotId: idSchema.optional() });
const maintenanceNoteSchema = z.string().trim().max(MAINTENANCE_NOTE_MAX).nullable().optional().transform((value) => value || null);
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createEmployee"), code: recordCodeSchema, name: z.string().trim().min(1).max(50), email: optionalEmailSchema, department: departmentNameSchema, nfcUid: optionalNfcUidSchema }),
  z.object({ action: z.literal("createVehicle"), code: recordCodeSchema, name: z.string().trim().min(1).max(50), plateNumber: z.string().trim().min(1).max(30), nfcUid: optionalNfcUidSchema, spotId: idSchema, color: z.string().regex(/^#[0-9a-fA-F]{6}$/), hasEtc: z.boolean().default(false), hasNavigation: z.boolean().default(false) }),
  z.object({ action: z.literal("updateEmployee"), id: idSchema, version: z.number().int().nonnegative(), code: recordCodeSchema.optional(), name: z.string().trim().min(1).max(50), email: optionalEmailSchema, department: departmentNameSchema, nfcUid: optionalNfcUidSchema }),
  z.object({ action: z.literal("updateEmployeeNfc"), id: idSchema, version: z.number().int().nonnegative(), nfcUid: optionalNfcUidSchema }),
  z.object({ action: z.literal("rotateEmployeeQr"), id: idSchema, version: z.number().int().nonnegative() }),
  z.object({ action: z.literal("rotateVehicleQr"), id: idSchema, version: z.number().int().nonnegative() }),
  z.object({ action: z.literal("updateVehicle"), id: idSchema, version: z.number().int().nonnegative(), code: recordCodeSchema.optional(), name: z.string().trim().min(1).max(50), plateNumber: z.string().trim().min(1).max(30), nfcUid: optionalNfcUidSchema, color: z.string().regex(/^#[0-9a-fA-F]{6}$/), hasEtc: z.boolean().optional(), hasNavigation: z.boolean().optional() }),
  z.object({ action: z.literal("updateVehicleNfc"), id: idSchema, version: z.number().int().nonnegative(), nfcUid: optionalNfcUidSchema }),
  z.object({ action: z.literal("setEmployeeActive"), id: idSchema, version: z.number().int().nonnegative(), active: z.boolean() }),
  z.object({ action: z.literal("setVehicleActive"), id: idSchema, version: z.number().int().nonnegative(), active: z.boolean() }),
  // maintenanceIdを渡すと、登録済みの整備予定を開始する。plannedEndは戻り予定で、nullなら未定。
  z.object({ action: z.literal("startMaintenance"), vehicleId: idSchema, version: z.number().int().nonnegative(), kind: z.enum(MAINTENANCE_KINDS), note: maintenanceNoteSchema, plannedEnd: z.string().datetime().nullable().optional(), maintenanceId: idSchema.optional() }),
  z.object({ action: z.literal("scheduleMaintenance"), vehicleId: idSchema, kind: z.enum(MAINTENANCE_KINDS), note: maintenanceNoteSchema, plannedStart: z.string().datetime(), plannedEnd: z.string().datetime() }),
  z.object({ action: z.literal("updateMaintenance"), maintenanceId: idSchema, version: z.number().int().nonnegative(), note: maintenanceNoteSchema, plannedStart: z.string().datetime().optional(), plannedEnd: z.string().datetime().nullable().optional() }),
  z.object({ action: z.literal("cancelMaintenance"), maintenanceId: idSchema, version: z.number().int().nonnegative() }),
  // spotIdを省くと、整備前の区画（車検で外出中も確保していた区画）に戻す。
  z.object({ action: z.literal("endMaintenance"), vehicleId: idSchema, version: z.number().int().nonnegative(), spotId: idSchema.optional(), fromSettings: z.boolean().optional(), ...actorSchema }),
  z.object({ action: z.literal("importEmployees"), items: z.array(employeeImportItemSchema).min(1).max(500) }),
  z.object({ action: z.literal("importVehicles"), items: z.array(vehicleImportItemSchema).min(1).max(500) }),
  z.object({ action: z.literal("start"), employeeId: idSchema, vehicleId: idSchema, minutes: z.number().int().min(15).max(10_080), ...actorSchema }),
  z.object({ action: z.literal("reserve"), employeeId: idSchema, vehicleId: idSchema, plannedStart: z.string().datetime(), minutes: z.number().int().min(15).max(10_080), ...actorSchema }),
  z.object({ action: z.literal("end"), tripId: idSchema, tripVersion: z.number().int().nonnegative(), vehicleId: idSchema, vehicleVersion: z.number().int().nonnegative(), spotId: idSchema, fuelLevel: z.number().int().min(0).max(FUEL_LEVEL_MAX).nullable().optional(), ...actorSchema }),
  z.object({ action: z.literal("undoReturn"), tripId: idSchema, vehicleId: idSchema, ...actorSchema }),
  z.object({ action: z.literal("moveTrip"), tripId: idSchema, version: z.number().int().nonnegative(), plannedStart: z.string().datetime(), plannedEnd: z.string().datetime(), ...actorSchema }),
  z.object({ action: z.literal("adjustTrip"), tripId: idSchema, version: z.number().int().nonnegative(), minutes: z.union([z.literal(-60), z.literal(-30), z.literal(-15), z.literal(15), z.literal(30), z.literal(60), z.literal(180), z.literal(300)]), ...actorSchema }),
  z.object({ action: z.literal("setTripEnd"), tripId: idSchema, version: z.number().int().nonnegative(), plannedEnd: z.string().datetime(), ...actorSchema }),
  z.object({ action: z.literal("setReservationStart"), tripId: idSchema, version: z.number().int().nonnegative(), plannedStart: z.string().datetime(), ...actorSchema }),
  z.object({ action: z.literal("correctActualStart"), tripId: idSchema, version: z.number().int().nonnegative(), actualStart: z.string().datetime(), reason: z.string().trim().min(1).max(200), ...actorSchema, actorEmployeeId: idSchema }),
  z.object({ action: z.literal("cancelTrip"), tripId: idSchema, version: z.number().int().nonnegative(), ...actorSchema }),
  z.object({ action: z.literal("moveVehicle"), vehicleId: idSchema, version: z.number().int().nonnegative(), spotId: idSchema, ...actorSchema }),
  z.object({ action: z.literal("updateSpot"), id: idSchema, version: z.number().int().nonnegative(), code: spotCodeSchema, label: spotLabelSchema.nullable(), role: z.enum(PARKING_SPOT_ROLES), dedicatedVehicleId: idSchema.nullable() }),
  z.object({ action: z.literal("setFuelLevel"), vehicleId: idSchema, version: z.number().int().nonnegative(), fuelLevel: z.number().int().min(0).max(FUEL_LEVEL_MAX), ...actorSchema }),
  z.object({ action: z.literal("createDepartment"), name: departmentNameSchema }),
  z.object({ action: z.literal("renameDepartment"), id: idSchema, version: z.number().int().nonnegative(), name: departmentNameSchema }),
  z.object({ action: z.literal("setDepartmentActive"), id: idSchema, version: z.number().int().nonnegative(), active: z.boolean() }),
  z.object({ action: z.literal("moveDepartment"), id: idSchema, direction: z.enum(["up", "down"]) }),
]);

// 部署の追加・停止・並べ替えと、社員の部署付け替えを順番に処理する。
async function lockDepartments(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('fleet-departments'))::text AS department_lock`;
}

async function nextDepartmentOrder(tx: Prisma.TransactionClient) {
  const last = await tx.department.aggregate({ _max: { sortOrder: true } });
  return (last._max.sortOrder ?? 0) + 1;
}

// 社員の登録・修正では、部署管理で登録済みの部署だけを選べる。停止中の部署は今の所属のままなら残せる。
async function findSelectableDepartment(tx: Prisma.TransactionClient, name: string, currentDepartmentId?: string) {
  await lockDepartments(tx);
  const department = await tx.department.findUnique({ where: { name } });
  if (!department) throw new Error(`部署「${name}」は登録されていません。設定の「部署」で追加してください`);
  if (!department.active && department.id !== currentDepartmentId) throw new Error(`部署「${name}」は利用停止中です`);
  return department;
}

// 専用区画に別の車を置こうとしたら止める。vehicleIdがnullなら、これから登録する車両として扱う。
async function assertSpotAllowsVehicle(tx: Prisma.TransactionClient, spot: { code: string; role: (typeof PARKING_SPOT_ROLES)[number]; dedicatedVehicleId: string | null; label: string | null }, vehicleId: string | null) {
  if (canUseSpot({ id: vehicleId ?? "" }, spot)) return;
  const dedicated = spot.dedicatedVehicleId ? await tx.vehicle.findUnique({ where: { id: spot.dedicatedVehicleId }, select: { name: true } }) : null;
  throw new Error(`${formatSpotLabel({ ...spot, dedicatedVehicleName: dedicated?.name ?? null })}には他の車両を駐車できません`);
}

// 利用再開した車両は、空いている仮置き区画へ置く。取り合いは仮置き用のロックで順番にする。
async function takeFreeHoldingSpot(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('fleet-holding-spots'))::text AS holding_lock`;
  const candidates = await tx.parkingSpot.findMany({ where: { role: "HOLDING", enabled: true, vehicle: { is: null } }, orderBy: { code: "asc" }, select: { id: true } });
  for (const candidate of candidates) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`fleet-spot:${candidate.id}`}))::text AS spot_lock`;
    // ロック待ちの間に配置図から車が置かれていないかを確かめる。
    const spot = await tx.parkingSpot.findUnique({ where: { id: candidate.id }, include: { vehicle: { select: { id: true } } } });
    if (spot?.enabled && spot.role === "HOLDING" && !spot.vehicle) return spot;
  }
  return null;
}

// 車両の整備予定・整備中の期間と重なる記録を探す。戻り予定が未定の整備は、終わりのない期間として扱う。
function findMaintenanceOverlap(tx: Prisma.TransactionClient, vehicleId: string, start: Date, end: Date, excludeId?: string) {
  return tx.vehicleMaintenance.findFirst({
    where: { vehicleId, id: excludeId ? { not: excludeId } : undefined, status: { in: ["SCHEDULED", "ACTIVE"] }, plannedStart: { lt: end }, OR: [{ plannedEnd: null }, { plannedEnd: { gt: start } }] },
    orderBy: { plannedStart: "asc" },
  });
}

async function assertNoMaintenanceOverlap(tx: Prisma.TransactionClient, vehicleId: string, start: Date, end: Date) {
  const maintenance = await findMaintenanceOverlap(tx, vehicleId, start, end);
  if (maintenance) throw new Error(maintenanceConflictMessage(maintenance));
}

// 整備の期間と重なる利用予定を探す。endがnullなら戻りが未定なので、start以降の予定はすべて重なる。
async function assertNoTripOverlap(tx: Prisma.TransactionClient, vehicleId: string, start: Date, end: Date | null) {
  const trip = await tx.trip.findFirst({
    where: { vehicleId, status: { in: ["RESERVED", "IN_USE"] }, plannedEnd: { gt: start }, ...(end ? { plannedStart: { lt: end } } : {}) },
    include: { employee: { select: { name: true } } },
    orderBy: { plannedStart: "asc" },
  });
  if (trip) throw new Error(`${trip.employee.name}さんの${trip.status === "IN_USE" ? "利用" : "予約"}（${formatMaintenanceTime(trip.plannedStart)}〜${formatMaintenanceTime(trip.plannedEnd)}）と重なっています。先に予約を移動または取り消してください`);
}

const lockVehicle = (tx: Prisma.TransactionClient, vehicleId: string) => tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`fleet-vehicle:${vehicleId}`}))::text AS vehicle_lock`;
async function lockTripForTimeChange(tx: Prisma.TransactionClient, tripId: string) {
  const original = await tx.trip.findUniqueOrThrow({ where: { id: tripId }, select: { employeeId: true, vehicleId: true } });
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`fleet-employee:${original.employeeId}`}))::text AS employee_lock, pg_advisory_xact_lock(hashtext(${`fleet-vehicle:${original.vehicleId}`}))::text AS vehicle_lock`;
  return tx.trip.findUniqueOrThrow({ where: { id: tripId } });
}

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
  const [employees, departments, vehicles, spots, trips, nextReservations, maintenances, backup, system] = await Promise.all([
    prisma.employee.findMany({ include: { employeeNumber: true, department: true, nfcAssignments: { include: { nfcTag: true }, orderBy: { validFrom: "desc" }, take: 1 } }, orderBy: { employeeNumber: { code: "asc" } } }),
    prisma.department.findMany({ include: { _count: { select: { employees: { where: { active: true } } } } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
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
    // 利用中の車両の予約は表示範囲に関係なく返す。延長できる上限と、超過が次の人へ響くかの表示に使う。
    prisma.trip.findMany({
      where: { status: "RESERVED", vehicle: { trips: { some: { status: "IN_USE" } } } },
      include: { employee: { include: { employeeNumber: true, department: true, nfcAssignments: { include: { nfcTag: true }, orderBy: { validFrom: "desc" }, take: 1 } } }, vehicle: { include: { vehicleNumber: true, nfcAssignments: { include: { nfcTag: true }, orderBy: { validFrom: "desc" }, take: 1 } } } }, orderBy: { plannedStart: "asc" },
    }),
    // 予定と整備中は範囲に関係なく返す。設定画面の予定一覧と、地図の「車検で不在」表示に使う。
    prisma.vehicleMaintenance.findMany({
      where: { OR: [{ status: { in: ["SCHEDULED", "ACTIVE"] } }, { status: "COMPLETED", actualStart: { lt: dayEnd }, actualEnd: { gt: dayStart } }] },
      orderBy: { plannedStart: "asc" },
    }),
    getBackupStatus(),
    getApplicationSystemStatus(),
  ]);
  const payload = {
    employees: employees.map((employee) => withEmployeeCode(employee)),
    departments: departments.map((department) => ({ id: department.id, name: department.name, active: department.active, version: department.version, employeeCount: department._count.employees })),
    vehicles: vehicles.map((vehicle) => withVehicleCode(vehicle)),
    spots: spots.map((spot) => ({ ...spot, dedicatedVehicleName: vehicles.find((vehicle) => vehicle.id === spot.dedicatedVehicleId)?.name ?? null, vehicle: spot.vehicle ? withVehicleCode(spot.vehicle) : null })),
    trips: trips.map((trip) => ({ ...trip, employee: withEmployeeCode(trip.employee), vehicle: withVehicleCode(trip.vehicle) })),
    nextReservations: nextReservations.map((trip) => ({ ...trip, employee: withEmployeeCode(trip.employee), vehicle: withVehicleCode(trip.vehicle) })),
    maintenances,
    system: {
      backupLatestAt: backup.latestAt,
      backupVerifiedAt: backup.verifiedAt,
      ...system,
    },
  };
  const body = JSON.stringify(payload);
  const etag = `"${createHash("sha256").update(body).digest("base64url")}"`;
  const headers = { "Cache-Control": "private, no-cache, must-revalidate", ETag: etag };
  // 5秒ごとの確認で内容が同じなら本文を返さず、通信量とクライアントの再描画を抑える。
  if (request.headers.get("If-None-Match") === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: "許可されていない送信元です" }, { status: 403 });
  let body: unknown;
  try { body = await readJsonBody(request); }
  catch (error) { return NextResponse.json({ message: error instanceof Error && error.message === "REQUEST_TOO_LARGE" ? "入力データが大きすぎます" : "入力内容を確認してください" }, { status: error instanceof Error && error.message === "REQUEST_TOO_LARGE" ? 413 : 400 }); }
  const operationIdResult = z.string().uuid().safeParse(typeof body === "object" && body !== null && "operationId" in body ? body.operationId : undefined);
  if (!operationIdResult.success) return NextResponse.json({ message: "操作IDを確認できません。画面を更新して再試行してください" }, { status: 400 });
  const operationId = operationIdResult.data;
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ message: "入力内容を確認してください", details: process.env.NODE_ENV === "development" ? parsed.error.issues : undefined }, { status: 400 });
  const input = parsed.data;
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
    let auditActor: { actorEmployeeId: string | null; actorName: string } = { actorEmployeeId: null, actorName: "共用端末" };
    if ("actorEmployeeId" in input && input.actorEmployeeId) {
      const actor = await prisma.employee.findFirst({ where: { id: input.actorEmployeeId, active: true }, select: { id: true, name: true } });
      if (!actor) return NextResponse.json({ message: "利用者を確認できません。社員証を再度読み取ってください" }, { status: 400 });
      auditActor = { actorEmployeeId: actor.id, actorName: actor.name };
    }
    if (input.action === "createEmployee") {
      assertRecordCode(input.code, "employee");
      if (input.nfcUid) await assertNfcAvailable(input.nfcUid);
      await prisma.$transaction(async (tx) => {
        const employeeNumber = await tx.employeeNumber.upsert({ where: { code: input.code }, update: {}, create: { code: input.code } });
        const department = await findSelectableDepartment(tx, input.department);
        const assigned = await tx.employee.findFirst({ where: { employeeNumberId: employeeNumber.id, active: true }, select: { name: true } });
        if (assigned) throw new Error(`社員番号${input.code}は「${assigned.name}」で使用中です。旧社員の利用を停止してから登録してください`);
        const employee = await tx.employee.create({ data: { employeeNumberId: employeeNumber.id, departmentId: department.id, name: input.name, email: input.email, qrToken: createQrToken() } });
        if (input.nfcUid) {
          const nfcTag = await tx.nfcTag.upsert({ where: { uid: input.nfcUid }, update: {}, create: { uid: input.nfcUid } });
          await tx.nfcAssignment.create({ data: { employeeId: employee.id, nfcTagId: nfcTag.id } });
        }
        await tx.auditLog.create({ data: { operationId, actorName: "設定画面", action: "社員登録", targetType: "Employee", targetId: employee.id, description: `${input.code} ${employee.name}を登録` } });
      });
    }
    if (input.action === "createVehicle") {
      assertRecordCode(input.code, "vehicle");
      if (input.nfcUid) await assertNfcAvailable(input.nfcUid);
      await prisma.$transaction(async (tx) => {
        // 新車は必ず区画を選んで登録する。場所が決まっていない車は仮置き区画を選ぶ。
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`fleet-spot:${input.spotId}`}))::text AS spot_lock`;
        const spot = await tx.parkingSpot.findUnique({ where: { id: input.spotId }, include: { vehicle: true } });
        if (!spot || !spot.enabled) throw new Error("選択した駐車区画は利用できません");
        if (spot.vehicle) throw new Error(`区画${spot.code}は使用中です`);
        await assertSpotAllowsVehicle(tx, spot, null);
        const vehicleNumber = await tx.vehicleNumber.upsert({ where: { code: input.code }, update: {}, create: { code: input.code } });
        const assigned = await tx.vehicle.findFirst({ where: { vehicleNumberId: vehicleNumber.id, active: true }, select: { name: true } });
        if (assigned) throw new Error(`車両番号${input.code}は「${assigned.name}」で使用中です。旧車両の利用を停止してから登録してください`);
        const vehicle = await tx.vehicle.create({ data: { vehicleNumberId: vehicleNumber.id, name: input.name, qrToken: createQrToken(), plateNumber: input.plateNumber, color: input.color, hasEtc: input.hasEtc, hasNavigation: input.hasNavigation, parkingSpotId: input.spotId } });
        if (input.nfcUid) {
          const nfcTag = await tx.nfcTag.upsert({ where: { uid: input.nfcUid }, update: {}, create: { uid: input.nfcUid } });
          await tx.nfcAssignment.create({ data: { vehicleId: vehicle.id, nfcTagId: nfcTag.id } });
        }
        await tx.auditLog.create({ data: { operationId, actorName: "設定画面", action: "車両登録", targetType: "Vehicle", targetId: vehicle.id, description: `${input.code} ${vehicle.name}を登録` } });
      });
    }
    if (input.action === "updateEmployee") {
      if (input.code !== undefined) assertRecordCode(input.code, "employee");
      if (input.nfcUid) await assertNfcAvailable(input.nfcUid, { employeeId: input.id });
      await prisma.$transaction(async (tx) => {
        const employee = await tx.employee.findUniqueOrThrow({ where: { id: input.id }, include: { employeeNumber: true, nfcAssignments: { where: { validTo: null }, include: { nfcTag: true }, take: 1 } } });
        const department = await findSelectableDepartment(tx, input.department, employee.departmentId);
        // 社員番号は他の（無効な）社員と共有され得るため、番号の行は書き換えず付け替える。
        const codeChanged = input.code !== undefined && input.code !== employee.employeeNumber.code;
        let employeeNumberId = employee.employeeNumberId;
        if (codeChanged) {
          const employeeNumber = await tx.employeeNumber.upsert({ where: { code: input.code! }, update: {}, create: { code: input.code! } });
          if (employee.active) {
            const assigned = await tx.employee.findFirst({ where: { employeeNumberId: employeeNumber.id, active: true, id: { not: employee.id } }, select: { name: true } });
            if (assigned) throw new Error(`社員番号${input.code}は「${assigned.name}」で使用中です`);
          }
          employeeNumberId = employeeNumber.id;
        }
        const updated = await tx.employee.updateMany({ where: { id: input.id, version: input.version }, data: { name: input.name, email: input.email ?? null, departmentId: department.id, employeeNumberId, version: { increment: 1 } } });
        if (updated.count !== 1) throw new Error("CONFLICT");
        // 付け替え前の番号は、ほかの社員が使っていなければ消して残さない。
        if (codeChanged) await tx.employeeNumber.deleteMany({ where: { id: employee.employeeNumberId, employees: { none: {} } } });
        const currentUid = employee.nfcAssignments[0]?.nfcTag.uid;
        if (currentUid !== input.nfcUid) {
          if (!employee.active) throw new Error("無効な社員のNFCカードは変更できません。先に社員を再有効化してください");
          const changedAt = new Date();
          await tx.nfcAssignment.updateMany({ where: { employeeId: employee.id, validTo: null }, data: { validTo: changedAt, cleared: !input.nfcUid } });
          if (input.nfcUid) {
            const nfcTag = await tx.nfcTag.upsert({ where: { uid: input.nfcUid }, update: {}, create: { uid: input.nfcUid } });
            await tx.nfcAssignment.create({ data: { employeeId: employee.id, nfcTagId: nfcTag.id, validFrom: changedAt } });
          }
        }
        await tx.auditLog.create({ data: { operationId, actorName: "設定画面", action: "社員情報修正", targetType: "Employee", targetId: input.id, description: codeChanged ? `${input.name}の登録情報を修正（社員番号 ${employee.employeeNumber.code}→${input.code}）` : `${input.name}の登録情報を修正` } });
      });
    }
    if (input.action === "updateEmployeeNfc") {
      if (input.nfcUid) await assertNfcAvailable(input.nfcUid, { employeeId: input.id });
      await prisma.$transaction(async (tx) => {
        const employee = await tx.employee.findUniqueOrThrow({
          where: { id: input.id },
          include: { nfcAssignments: { where: { validTo: null }, include: { nfcTag: true }, take: 1 } },
        });
        if (!employee.active) throw new Error("利用停止中の社員のNFCカードは変更できません。先に利用を再開してください");
        const currentUid = employee.nfcAssignments[0]?.nfcTag.uid ?? "";
        if (currentUid === input.nfcUid) return;
        const updated = await tx.employee.updateMany({
          where: { id: input.id, version: input.version },
          data: { version: { increment: 1 } },
        });
        if (updated.count !== 1) throw new Error("CONFLICT");
        const changedAt = new Date();
        await tx.nfcAssignment.updateMany({
          where: { employeeId: employee.id, validTo: null },
          data: { validTo: changedAt, cleared: !input.nfcUid },
        });
        if (input.nfcUid) {
          const nfcTag = await tx.nfcTag.upsert({ where: { uid: input.nfcUid }, update: {}, create: { uid: input.nfcUid } });
          await tx.nfcAssignment.create({ data: { employeeId: employee.id, nfcTagId: nfcTag.id, validFrom: changedAt } });
        }
        await tx.auditLog.create({
          data: {
            operationId,
            actorName: "設定画面",
            action: input.nfcUid ? (currentUid ? "社員NFC変更" : "社員NFC登録") : "社員NFC解除",
            targetType: "Employee",
            targetId: employee.id,
            description: `${employee.name}のNFCカードを${input.nfcUid ? (currentUid ? "変更" : "登録") : "解除"}`,
          },
        });
      });
    }
    if (input.action === "rotateEmployeeQr") {
      await prisma.$transaction(async (tx) => {
        const employee = await tx.employee.findUniqueOrThrow({ where: { id: input.id }, select: { name: true, active: true } });
        if (!employee.active) throw new Error("利用停止中の社員QRは再発行できません");
        const updated = await tx.employee.updateMany({
          where: { id: input.id, version: input.version, active: true },
          data: { qrToken: createQrToken(), version: { increment: 1 } },
        });
        if (updated.count !== 1) throw new Error("CONFLICT");
        await tx.auditLog.create({
          data: {
            operationId,
            actorName: "設定画面",
            action: "社員QR再発行",
            targetType: "Employee",
            targetId: input.id,
            description: `${employee.name}のQRコードを再発行（旧QRを無効化）`,
          },
        });
      });
    }
    if (input.action === "rotateVehicleQr") {
      await prisma.$transaction(async (tx) => {
        const vehicle = await tx.vehicle.findUniqueOrThrow({ where: { id: input.id }, select: { name: true, active: true } });
        if (!vehicle.active) throw new Error("利用停止中の車両QRは再発行できません");
        const updated = await tx.vehicle.updateMany({
          where: { id: input.id, version: input.version, active: true },
          data: { qrToken: createQrToken(), version: { increment: 1 } },
        });
        if (updated.count !== 1) throw new Error("CONFLICT");
        await tx.auditLog.create({
          data: {
            operationId,
            actorName: "設定画面",
            action: "車両QR再発行",
            targetType: "Vehicle",
            targetId: input.id,
            description: `${vehicle.name}のQRコードを再発行（旧QRを無効化）`,
          },
        });
      });
    }
    if (input.action === "updateVehicle") {
      if (input.code !== undefined) assertRecordCode(input.code, "vehicle");
      if (input.nfcUid) await assertNfcAvailable(input.nfcUid, { vehicleId: input.id });
      await prisma.$transaction(async (tx) => {
        const vehicle = await tx.vehicle.findUniqueOrThrow({ where: { id: input.id }, include: { vehicleNumber: true, nfcAssignments: { where: { validTo: null }, include: { nfcTag: true }, take: 1 } } });
        // 車両番号は他の（無効な）車両と共有され得るため、番号の行は書き換えず付け替える。
        const codeChanged = input.code !== undefined && input.code !== vehicle.vehicleNumber.code;
        let vehicleNumberId = vehicle.vehicleNumberId;
        if (codeChanged) {
          const vehicleNumber = await tx.vehicleNumber.upsert({ where: { code: input.code! }, update: {}, create: { code: input.code! } });
          if (vehicle.active) {
            const assigned = await tx.vehicle.findFirst({ where: { vehicleNumberId: vehicleNumber.id, active: true, id: { not: vehicle.id } }, select: { name: true } });
            if (assigned) throw new Error(`車両番号${input.code}は「${assigned.name}」で使用中です`);
          }
          vehicleNumberId = vehicleNumber.id;
        }
        const updated = await tx.vehicle.updateMany({ where: { id: input.id, version: input.version }, data: { vehicleNumberId, name: input.name, plateNumber: input.plateNumber, color: input.color, ...(input.hasEtc === undefined ? {} : { hasEtc: input.hasEtc }), ...(input.hasNavigation === undefined ? {} : { hasNavigation: input.hasNavigation }), version: { increment: 1 } } });
        if (updated.count !== 1) throw new Error("CONFLICT");
        // 付け替え前の番号は、ほかの車両が使っていなければ消して残さない。
        if (codeChanged) await tx.vehicleNumber.deleteMany({ where: { id: vehicle.vehicleNumberId, vehicles: { none: {} } } });
        const currentUid = vehicle.nfcAssignments[0]?.nfcTag.uid;
        if (currentUid !== input.nfcUid) {
          if (!vehicle.active) throw new Error("無効な車両のNFCタグは変更できません。先に車両を再有効化してください");
          const changedAt = new Date();
          await tx.nfcAssignment.updateMany({ where: { vehicleId: vehicle.id, validTo: null }, data: { validTo: changedAt, cleared: !input.nfcUid } });
          if (input.nfcUid) {
            const nfcTag = await tx.nfcTag.upsert({ where: { uid: input.nfcUid }, update: {}, create: { uid: input.nfcUid } });
            await tx.nfcAssignment.create({ data: { vehicleId: vehicle.id, nfcTagId: nfcTag.id, validFrom: changedAt } });
          }
        }
        await tx.auditLog.create({ data: { operationId, actorName: "設定画面", action: "車両情報修正", targetType: "Vehicle", targetId: input.id, description: codeChanged ? `${input.name}の登録情報を修正（車両番号 ${vehicle.vehicleNumber.code}→${input.code}）` : `${input.name}の登録情報を修正` } });
      });
    }
    if (input.action === "updateVehicleNfc") {
      if (input.nfcUid) await assertNfcAvailable(input.nfcUid, { vehicleId: input.id });
      await prisma.$transaction(async (tx) => {
        const vehicle = await tx.vehicle.findUniqueOrThrow({
          where: { id: input.id },
          include: { nfcAssignments: { where: { validTo: null }, include: { nfcTag: true }, take: 1 } },
        });
        if (!vehicle.active) throw new Error("利用停止中の車両のNFCタグは変更できません。先に利用を再開してください");
        const currentUid = vehicle.nfcAssignments[0]?.nfcTag.uid ?? "";
        if (currentUid === input.nfcUid) return;
        const updated = await tx.vehicle.updateMany({
          where: { id: input.id, version: input.version },
          data: { version: { increment: 1 } },
        });
        if (updated.count !== 1) throw new Error("CONFLICT");
        const changedAt = new Date();
        await tx.nfcAssignment.updateMany({
          where: { vehicleId: vehicle.id, validTo: null },
          data: { validTo: changedAt, cleared: !input.nfcUid },
        });
        if (input.nfcUid) {
          const nfcTag = await tx.nfcTag.upsert({ where: { uid: input.nfcUid }, update: {}, create: { uid: input.nfcUid } });
          await tx.nfcAssignment.create({ data: { vehicleId: vehicle.id, nfcTagId: nfcTag.id, validFrom: changedAt } });
        }
        await tx.auditLog.create({
          data: {
            operationId,
            actorName: "設定画面",
            action: input.nfcUid ? (currentUid ? "車両NFC変更" : "車両NFC登録") : "車両NFC解除",
            targetType: "Vehicle",
            targetId: vehicle.id,
            description: `${vehicle.name}のNFCタグを${input.nfcUid ? (currentUid ? "変更" : "登録") : "解除"}`,
          },
        });
      });
    }
    if (input.action === "setEmployeeActive") {
      await prisma.$transaction(async (tx) => {
        const employee = await tx.employee.findUniqueOrThrow({ where: { id: input.id }, include: { nfcAssignments: { include: { nfcTag: true }, orderBy: { validFrom: "desc" }, take: 1 } } });
        if (!input.active) {
          const activeTrip = await tx.trip.findFirst({ where: { employeeId: input.id, status: { in: ["RESERVED", "IN_USE"] } } });
          if (activeTrip) throw new Error("利用中または予約中の社員は利用停止できません");
        }
        if (input.active) {
          const assigned = await tx.employee.findFirst({ where: { employeeNumberId: employee.employeeNumberId, active: true, id: { not: employee.id } }, select: { name: true } });
          if (assigned) throw new Error(`この社員番号は「${assigned.name}」で使用中のため利用再開できません`);
          // NFCは任意のため、戻すカードがなければカードなしで再開する。
          const latestTag = restorableNfcTag(employee.nfcAssignments);
          if (latestTag) {
            const cardOwner = await tx.nfcAssignment.findFirst({ where: { nfcTagId: latestTag.id, validTo: null }, select: { employee: { select: { name: true } }, vehicle: { select: { name: true } } } });
            const owner = cardOwner?.employee?.name ?? cardOwner?.vehicle?.name;
            if (owner) throw new Error(`以前のNFCカードは「${owner}」で使用中です。別のカードで新規登録してください`);
            await tx.nfcAssignment.create({ data: { employeeId: employee.id, nfcTagId: latestTag.id } });
          }
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
        if (!input.active && vehicle.status !== "AVAILABLE") throw new Error("利用中・予約中・整備中の車両は利用停止できません");
        if (!input.active && await tx.vehicleMaintenance.findFirst({ where: { vehicleId: input.id, status: "SCHEDULED" }, select: { id: true } })) throw new Error("整備予定がある車両は利用停止できません。先に整備予定を取り消してください");
        if (input.active) {
          const assigned = await tx.vehicle.findFirst({ where: { vehicleNumberId: vehicle.vehicleNumberId, active: true, id: { not: vehicle.id } }, select: { name: true } });
          if (assigned) throw new Error(`この車両番号は「${assigned.name}」で使用中のため利用再開できません`);
          const latestTag = restorableNfcTag(vehicle.nfcAssignments);
          if (latestTag) {
            const tagOwner = await tx.nfcAssignment.findFirst({ where: { nfcTagId: latestTag.id, validTo: null }, select: { employee: { select: { name: true } }, vehicle: { select: { name: true } } } });
            const owner = tagOwner?.employee?.name ?? tagOwner?.vehicle?.name;
            if (owner) throw new Error(`以前のNFCタグは「${owner}」で使用中です。別のタグで新規登録してください`);
            await tx.nfcAssignment.create({ data: { vehicleId: vehicle.id, nfcTagId: latestTag.id } });
          }
        }
        // 利用停止で区画を空けているため、再開時は空いている仮置き区画へ置く。空きがなければ位置未設定のまま再開する。
        const holdingSpot = input.active && !vehicle.active && !vehicle.parkingSpotId ? await takeFreeHoldingSpot(tx) : null;
        const updated = await tx.vehicle.updateMany({ where: { id: input.id, version: input.version }, data: { active: input.active, parkingSpotId: input.active ? vehicle.parkingSpotId ?? holdingSpot?.id ?? null : null, version: { increment: 1 } } });
        if (updated.count !== 1) throw new Error("CONFLICT");
        if (!input.active) await tx.nfcAssignment.updateMany({ where: { vehicleId: vehicle.id, validTo: null }, data: { validTo: new Date() } });
        await tx.auditLog.create({ data: { operationId, actorName: "設定画面", action: input.active ? "車両再有効化" : "車両無効化", targetType: "Vehicle", targetId: input.id, description: input.active ? `車両を再有効化${holdingSpot ? `（仮置き${holdingSpot.code}）` : ""}` : "車両を無効化" } });
      });
    }
    if (input.action === "startMaintenance") {
      const now = new Date();
      const plannedEnd = input.plannedEnd ? new Date(input.plannedEnd) : null;
      if (plannedEnd && plannedEnd <= now) throw new Error("戻り予定は現在時刻より後にしてください");
      if (plannedEnd && plannedEnd.getTime() > now.getTime() + MAINTENANCE_MAX_DAYS * 24 * 60 * 60_000) throw new Error(`戻り予定は${MAINTENANCE_MAX_DAYS}日以内で指定してください`);
      await prisma.$transaction(async (tx) => {
        await lockVehicle(tx, input.vehicleId);
        const vehicle = await tx.vehicle.findUniqueOrThrow({ where: { id: input.vehicleId }, select: { name: true, active: true, status: true, parkingSpot: { select: { code: true } } } });
        if (!vehicle.active) throw new Error("無効な車両は整備中にできません");
        if (vehicle.status === "MAINTENANCE") throw new Error("この車両はすでに整備中です");
        if (vehicle.status !== "AVAILABLE") throw new Error("利用中の車両は整備中にできません。返却してから変更してください");
        // 故障はすぐ記録できるよう、今すぐの開始は予約と重なっても止めない。車検で外出しても区画は外さず確保する。
        const updated = await tx.vehicle.updateMany({ where: { id: input.vehicleId, version: input.version, status: "AVAILABLE" }, data: { status: "MAINTENANCE", version: { increment: 1 } } });
        if (updated.count !== 1) throw new Error("CONFLICT");
        const data = { kind: input.kind, note: input.note, status: "ACTIVE" as const, plannedStart: now, plannedEnd, actualStart: now };
        if (input.maintenanceId) {
          const started = await tx.vehicleMaintenance.updateMany({ where: { id: input.maintenanceId, vehicleId: input.vehicleId, status: "SCHEDULED" }, data: { ...data, version: { increment: 1 } } });
          if (started.count !== 1) throw new Error("この整備予定は開始できません。最新状態を確認してください");
        } else {
          await tx.vehicleMaintenance.create({ data: { vehicleId: input.vehicleId, ...data } });
        }
        const kept = input.kind === "OFF_SITE" && vehicle.parkingSpot ? `。区画${vehicle.parkingSpot.code}は確保` : "";
        await tx.auditLog.create({ data: { operationId, actorName: "設定画面", action: "車両整備開始", targetType: "Vehicle", targetId: input.vehicleId, description: `${vehicle.name}を${MAINTENANCE_KIND_SHORT_LABELS[input.kind]}に変更${plannedEnd ? `（戻り予定 ${formatMaintenanceTime(plannedEnd)}）` : ""}${kept}` } });
      });
    }
    if (input.action === "scheduleMaintenance") {
      const now = new Date();
      const plannedStart = new Date(input.plannedStart);
      const plannedEnd = new Date(input.plannedEnd);
      if (plannedStart.getTime() < now.getTime() - 60_000) throw new Error("開始予定は現在時刻より後にしてください");
      if (plannedStart.getTime() > now.getTime() + MAINTENANCE_SCHEDULE_DAYS_AHEAD * 24 * 60 * 60_000) throw new Error("整備予定は1年先までで登録してください");
      if (plannedEnd <= plannedStart) throw new Error("戻り予定は開始予定より後にしてください");
      if (plannedEnd.getTime() - plannedStart.getTime() > MAINTENANCE_MAX_DAYS * 24 * 60 * 60_000) throw new Error(`整備期間は${MAINTENANCE_MAX_DAYS}日以内で指定してください`);
      await prisma.$transaction(async (tx) => {
        await lockVehicle(tx, input.vehicleId);
        const vehicle = await tx.vehicle.findUniqueOrThrow({ where: { id: input.vehicleId }, select: { name: true, active: true } });
        if (!vehicle.active) throw new Error("無効な車両には整備予定を登録できません");
        await assertNoTripOverlap(tx, input.vehicleId, plannedStart, plannedEnd);
        await assertNoMaintenanceOverlap(tx, input.vehicleId, plannedStart, plannedEnd);
        const maintenance = await tx.vehicleMaintenance.create({ data: { vehicleId: input.vehicleId, kind: input.kind, note: input.note, plannedStart, plannedEnd } });
        await tx.auditLog.create({ data: { operationId, actorName: "設定画面", action: "整備予定登録", targetType: "VehicleMaintenance", targetId: maintenance.id, description: `${vehicle.name}の${MAINTENANCE_KIND_SHORT_LABELS[input.kind]}を${formatMaintenanceTime(plannedStart)}〜${formatMaintenanceTime(plannedEnd)}で予定` } });
      });
    }
    if (input.action === "updateMaintenance") {
      const now = new Date();
      await prisma.$transaction(async (tx) => {
        const current = await tx.vehicleMaintenance.findUniqueOrThrow({ where: { id: input.maintenanceId }, include: { vehicle: { select: { name: true } } } });
        await lockVehicle(tx, current.vehicleId);
        if (current.status !== "SCHEDULED" && current.status !== "ACTIVE") throw new Error("完了・取消済みの整備は変更できません");
        const scheduled = current.status === "SCHEDULED";
        // 整備中は開始日時を動かさない。戻り予定と備考だけを直す。
        const plannedStart = scheduled && input.plannedStart ? new Date(input.plannedStart) : current.plannedStart;
        const plannedEnd = input.plannedEnd === undefined ? current.plannedEnd : input.plannedEnd ? new Date(input.plannedEnd) : null;
        if (scheduled && !plannedEnd) throw new Error("整備予定には戻り予定が必要です");
        if (scheduled && plannedStart.getTime() !== current.plannedStart.getTime() && plannedStart.getTime() < now.getTime() - 60_000) throw new Error("開始予定は現在時刻より後にしてください");
        if (plannedEnd && plannedEnd <= (scheduled ? plannedStart : now)) throw new Error(scheduled ? "戻り予定は開始予定より後にしてください" : "戻り予定は現在時刻より後にしてください");
        if (plannedEnd && plannedEnd.getTime() - Math.max(plannedStart.getTime(), now.getTime()) > MAINTENANCE_MAX_DAYS * 24 * 60 * 60_000) throw new Error(`整備期間は${MAINTENANCE_MAX_DAYS}日以内で指定してください`);
        await assertNoTripOverlap(tx, current.vehicleId, scheduled ? plannedStart : now, plannedEnd);
        const overlap = await findMaintenanceOverlap(tx, current.vehicleId, plannedStart, plannedEnd ?? new Date("9999-12-31T00:00:00Z"), current.id);
        if (overlap) throw new Error(maintenanceConflictMessage(overlap));
        const updated = await tx.vehicleMaintenance.updateMany({ where: { id: current.id, version: input.version, status: current.status }, data: { note: input.note, plannedStart, plannedEnd, version: { increment: 1 } } });
        if (updated.count !== 1) throw new Error("CONFLICT");
        await tx.auditLog.create({ data: { operationId, actorName: "設定画面", action: scheduled ? "整備予定変更" : "整備内容変更", targetType: "VehicleMaintenance", targetId: current.id, description: `${current.vehicle.name}の${scheduled ? `整備予定を${formatMaintenanceTime(plannedStart)}〜` : "戻り予定を"}${plannedEnd ? formatMaintenanceTime(plannedEnd) : "未定"}に変更` } });
      });
    }
    if (input.action === "cancelMaintenance") {
      await prisma.$transaction(async (tx) => {
        const current = await tx.vehicleMaintenance.findUniqueOrThrow({ where: { id: input.maintenanceId }, include: { vehicle: { select: { name: true } } } });
        if (current.status !== "SCHEDULED") throw new Error("開始前の整備予定だけ取り消せます");
        const updated = await tx.vehicleMaintenance.updateMany({ where: { id: current.id, version: input.version, status: "SCHEDULED" }, data: { status: "CANCELLED", version: { increment: 1 } } });
        if (updated.count !== 1) throw new Error("CONFLICT");
        await tx.auditLog.create({ data: { operationId, actorName: "設定画面", action: "整備予定取消", targetType: "VehicleMaintenance", targetId: current.id, description: `${current.vehicle.name}の${formatMaintenanceTime(current.plannedStart)}からの整備予定を取り消し` } });
      });
    }
    if (input.action === "endMaintenance") {
      const actor = input.fromSettings ? { actorEmployeeId: null, actorName: "設定画面" } : auditActor;
      await prisma.$transaction(async (tx) => {
        if (input.spotId) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`fleet-spot:${input.spotId}`}))::text AS spot_lock`;
        await lockVehicle(tx, input.vehicleId);
        const vehicle = await tx.vehicle.findUniqueOrThrow({ where: { id: input.vehicleId }, select: { name: true, status: true, parkingSpotId: true, parkingSpot: { select: { code: true } } } });
        if (vehicle.status !== "MAINTENANCE") throw new Error("この車両は整備中ではありません");
        // 整備記録を作る前から整備中だった車両は記録がないため、車両の状態だけを戻す。
        const active = await tx.vehicleMaintenance.findFirst({ where: { vehicleId: input.vehicleId, status: "ACTIVE" }, orderBy: { plannedStart: "desc" } });
        let spotId = vehicle.parkingSpotId;
        let spotCode = vehicle.parkingSpot?.code ?? null;
        if (input.spotId && input.spotId !== vehicle.parkingSpotId) {
          const target = await tx.parkingSpot.findUniqueOrThrow({ where: { id: input.spotId }, include: { vehicle: { select: { id: true } } } });
          if (!target.enabled) throw new Error("選択した駐車区画は利用できません");
          if (target.vehicle && target.vehicle.id !== input.vehicleId) throw new Error(`区画${target.code}は使用中です`);
          await assertSpotAllowsVehicle(tx, target, input.vehicleId);
          spotId = target.id;
          spotCode = target.code;
        }
        const updated = await tx.vehicle.updateMany({ where: { id: input.vehicleId, version: input.version, status: "MAINTENANCE" }, data: { status: "AVAILABLE", parkingSpotId: spotId, version: { increment: 1 } } });
        if (updated.count !== 1) throw new Error("CONFLICT");
        if (active) await tx.vehicleMaintenance.update({ where: { id: active.id }, data: { status: "COMPLETED", actualEnd: new Date(), returnSpotCode: spotCode, version: { increment: 1 } } });
        const offSite = active?.kind === "OFF_SITE";
        const moved = spotId !== vehicle.parkingSpotId && spotCode ? `（区画${spotCode}へ移動）` : "";
        await tx.auditLog.create({ data: { operationId, ...actor, action: offSite ? "車検・修理から戻り" : "車両整備解除", targetType: "Vehicle", targetId: input.vehicleId, description: offSite ? `${vehicle.name}が戻り、${spotCode ? `区画${spotCode}へ駐車` : "駐車位置は未設定"}` : `${vehicle.name}を利用可能に変更${moved}` } });
      });
    }
    if (input.action === "importEmployees") {
      input.items.forEach((item, index) => assertRecordCode(item.code, "employee", index + 1));
      const codes = new Set<string>();
      const nfcUids = new Set<string>();
      const emails = new Set<string>();
      for (const item of input.items) {
        const codeKey = item.code.toLocaleUpperCase("ja");
        if (codes.has(codeKey)) throw new Error(`JSON内で社員番号${item.code}が重複しています`);
        codes.add(codeKey);
        if (item.nfcUid) {
          const nfcKey = item.nfcUid.toLocaleUpperCase("ja");
          if (nfcUids.has(nfcKey)) throw new Error(`JSON内でNFC UID ${item.nfcUid}が重複しています`);
          nfcUids.add(nfcKey);
        }
        if (item.email) {
          const emailKey = item.email.toLowerCase();
          if (emails.has(emailKey)) throw new Error(`JSON内でメールアドレス ${item.email}が重複しています`);
          emails.add(emailKey);
        }
      }
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('fleet-import-employees'))::text AS import_lock`;
        await lockDepartments(tx);
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
          // JSON取込では、未登録の部署は末尾に追加し、停止中の部署は再開する。
          let department = await tx.department.findUnique({ where: { name: item.department } });
          if (!department) department = await tx.department.create({ data: { name: item.department, sortOrder: await nextDepartmentOrder(tx) } });
          else if (!department.active) department = await tx.department.update({ where: { id: department.id }, data: { active: true, sortOrder: await nextDepartmentOrder(tx), version: { increment: 1 } } });
          const employee = await tx.employee.create({ data: { employeeNumberId: employeeNumber.id, departmentId: department.id, name: item.name, email: item.email, qrToken: createQrToken() } });
          if (item.nfcUid) {
            const nfcTag = await tx.nfcTag.upsert({ where: { uid: item.nfcUid }, update: {}, create: { uid: item.nfcUid } });
            await tx.nfcAssignment.create({ data: { employeeId: employee.id, nfcTagId: nfcTag.id } });
          }
        }
        await tx.auditLog.create({ data: { operationId, actorName: "設定画面", action: "社員JSON取込", targetType: "Employee", targetId: "bulk", description: `${input.items.length}人をJSONから一括登録` } });
      });
    }
    if (input.action === "importVehicles") {
      input.items.forEach((item, index) => assertRecordCode(item.code, "vehicle", index + 1));
      const codes = new Set<string>();
      const plates = new Set<string>();
      const nfcUids = new Set<string>();
      const spotIds = new Set<string>();
      for (const item of input.items) {
        if (item.spotId) {
          if (spotIds.has(item.spotId)) throw new Error("JSON内で同じ駐車区画が複数の車両に割り当てられています");
          spotIds.add(item.spotId);
        }
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
        // 区画を割り当てる場合は、配置図の移動や新規登録と同じ区画ロックを順番に取る。
        for (const spotId of [...spotIds].sort()) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`fleet-spot:${spotId}`}))::text AS spot_lock`;
        for (const item of input.items) {
          if (item.spotId) {
            const spot = await tx.parkingSpot.findUnique({ where: { id: item.spotId }, include: { vehicle: true } });
            if (!spot || !spot.enabled) throw new Error(`${item.name}に選択した駐車区画は利用できません`);
            if (spot.vehicle) throw new Error(`区画${spot.code}は使用中です`);
            await assertSpotAllowsVehicle(tx, spot, null);
          }
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
          const vehicle = await tx.vehicle.create({ data: { vehicleNumberId: vehicleNumber.id, name: item.name, qrToken: createQrToken(), plateNumber: item.plateNumber, color: item.color, hasEtc: item.hasEtc, hasNavigation: item.hasNavigation, parkingSpotId: item.spotId } });
          if (item.nfcUid) {
            const nfcTag = await tx.nfcTag.upsert({ where: { uid: item.nfcUid }, update: {}, create: { uid: item.nfcUid } });
            await tx.nfcAssignment.create({ data: { vehicleId: vehicle.id, nfcTagId: nfcTag.id } });
          }
        }
        await tx.auditLog.create({ data: { operationId, actorName: "設定画面", action: "車両JSON取込", targetType: "Vehicle", targetId: "bulk", description: `${input.items.length}台をJSONから一括登録${spotIds.size ? `（区画に配置 ${spotIds.size}台）` : ""}` } });
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
        await assertNoMaintenanceOverlap(tx, vehicle.id, now, plannedEnd);
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
        const snapshot = await captureTripStartSnapshot(tx, employee.id, vehicle.id, now);
        if (reservation) {
          await tx.trip.update({ where: { id: reservation.id }, data: { status: "IN_USE", actualStart: now, ...snapshot, version: { increment: 1 } } });
        } else {
          await tx.trip.create({ data: { employeeId: input.employeeId, vehicleId: input.vehicleId, plannedStart: now, plannedEnd, actualStart: now, status: "IN_USE", purpose: "", ...snapshot } });
        }
        await tx.auditLog.create({ data: { operationId, ...auditActor, action: "利用開始", targetType: "Vehicle", targetId: input.vehicleId, description: reservation ? "予約から利用を開始" : `${input.minutes}分の利用を開始` } });
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
        if (!vehicle.active || (vehicle.status !== "AVAILABLE" && vehicle.status !== "MAINTENANCE")) throw new Error("この車両は現在予約できません");
        if (!employee.active) throw new Error("この社員は現在予約できません");
        await assertNoMaintenanceOverlap(tx, vehicle.id, plannedStart, plannedEnd);
        // 整備中の車両は、戻り予定が決まっていればその後だけ予約できる。重なりは上で確認済み。
        if (vehicle.status === "MAINTENANCE" && !await tx.vehicleMaintenance.findFirst({ where: { vehicleId: vehicle.id, status: "ACTIVE", plannedEnd: { lte: plannedStart } }, select: { id: true } })) throw new Error("整備中のため予約できません。戻り予定が決まれば、その後の時間を予約できます");
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
        await tx.auditLog.create({ data: { operationId, ...auditActor, action: "予約登録", targetType: "Trip", targetId: trip.id, description: `${input.minutes}分の利用予定を登録` } });
      });
    }
    if (input.action === "end") {
      const fuelLevel = input.fuelLevel ?? null;
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`fleet-spot:${input.spotId}`}))::text AS spot_lock, pg_advisory_xact_lock(hashtext(${`fleet-vehicle:${input.vehicleId}`}))::text AS vehicle_lock`;
        const [target, returningVehicle] = await Promise.all([
          tx.parkingSpot.findUniqueOrThrow({ where: { id: input.spotId }, include: { vehicle: true } }),
          tx.vehicle.findUniqueOrThrow({ where: { id: input.vehicleId }, select: { fuelLevel: true } }),
        ]);
        if (target.vehicle && target.vehicle.id !== input.vehicleId) throw new Error(`区画${target.code}は使用中です`);
        await assertSpotAllowsVehicle(tx, target, input.vehicleId);
        const trip = await tx.trip.updateMany({ where: { id: input.tripId, vehicleId: input.vehicleId, version: input.tripVersion, status: "IN_USE" }, data: { status: "COMPLETED", actualEnd: new Date(), returnSpotCode: target.code, returnFuelLevel: fuelLevel, previousFuelLevel: fuelLevel === null ? null : returningVehicle.fuelLevel, version: { increment: 1 } } });
        const vehicle = await tx.vehicle.updateMany({ where: { id: input.vehicleId, version: input.vehicleVersion }, data: { status: "AVAILABLE", parkingSpotId: input.spotId, ...(fuelLevel === null ? {} : { fuelLevel }), version: { increment: 1 } } });
        if (trip.count !== 1 || vehicle.count !== 1) throw new Error("CONFLICT");
        await tx.auditLog.create({ data: { operationId, ...auditActor, action: "返却", targetType: "Trip", targetId: input.tripId, description: `区画${target.code}へ返却${fuelLevel === null ? "" : `（残量 ${formatFuelLevel(fuelLevel)}）`}` } });
      });
    }
    if (input.action === "undoReturn") {
      const now = new Date();
      await prisma.$transaction(async (tx) => {
        const trip = await tx.trip.findUniqueOrThrow({ where: { id: input.tripId }, include: { vehicle: true, employee: true } });
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`fleet-employee:${trip.employeeId}`}))::text AS employee_lock, pg_advisory_xact_lock(hashtext(${`fleet-vehicle:${trip.vehicleId}`}))::text AS vehicle_lock`;
        if (trip.vehicleId !== input.vehicleId || trip.status !== "COMPLETED" || !trip.actualEnd) throw new Error("この返却記録は取り消せません");
        // 画面の案内は30秒で消える。端末の時計のずれや通信の遅れを見込み、サーバーは2分まで受け付ける。
        if (now.getTime() - trip.actualEnd.getTime() > 2 * 60_000) throw new Error("返却から2分を過ぎたため、画面からは取り消せません");
        const [vehicle, employeeConflict, subsequentTrip, laterVehicleAction] = await Promise.all([
          tx.vehicle.findUniqueOrThrow({ where: { id: trip.vehicleId } }),
          tx.trip.findFirst({ where: { employeeId: trip.employeeId, status: "IN_USE" } }),
          tx.trip.findFirst({ where: { id: { not: trip.id }, vehicleId: trip.vehicleId, actualStart: { gt: trip.actualEnd } } }),
          tx.auditLog.findFirst({ where: { targetType: "Vehicle", targetId: trip.vehicleId, createdAt: { gt: trip.actualEnd } } }),
        ]);
        if (vehicle.status !== "AVAILABLE" || employeeConflict || subsequentTrip || laterVehicleAction) throw new Error("返却後に車両または利用者の状態が変更されたため取り消せません");
        const restoredTrip = await tx.trip.updateMany({ where: { id: trip.id, status: "COMPLETED", version: trip.version }, data: { status: "IN_USE", actualEnd: null, returnSpotCode: null, returnFuelLevel: null, previousFuelLevel: null, version: { increment: 1 } } });
        const restoredVehicle = await tx.vehicle.updateMany({ where: { id: vehicle.id, status: "AVAILABLE", version: vehicle.version }, data: { status: "IN_USE", parkingSpotId: null, ...(trip.returnFuelLevel === null ? {} : { fuelLevel: trip.previousFuelLevel }), version: { increment: 1 } } });
        if (restoredTrip.count !== 1 || restoredVehicle.count !== 1) throw new Error("CONFLICT");
        await tx.auditLog.create({ data: { operationId, ...auditActor, action: "返却取消", targetType: "Trip", targetId: trip.id, description: `${trip.vehicle.name}の返却を取り消して利用中へ復元` } });
      });
    }
    if (input.action === "setReservationStart" || input.action === "correctActualStart") {
      await updateTripStart(input, operationId, auditActor);
    }
    if (input.action === "moveTrip") {
      await prisma.$transaction(async (tx) => {
        const trip = await lockTripForTimeChange(tx, input.tripId);
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
        await assertNoMaintenanceOverlap(tx, trip.vehicleId, plannedStart, plannedEnd);
        const updated = await tx.trip.updateMany({ where: { id: trip.id, version: input.version, status: "RESERVED" }, data: { plannedStart, plannedEnd, version: { increment: 1 } } });
        if (updated.count !== 1) throw new Error("CONFLICT");
        await tx.auditLog.create({ data: { operationId, ...auditActor, action: "利用時間修正", targetType: "Trip", targetId: trip.id, description: "タイムラインから時間を変更" } });
      });
    }
    if (input.action === "adjustTrip") {
      await prisma.$transaction(async (tx) => {
        const trip = await lockTripForTimeChange(tx, input.tripId);
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
          await assertNoMaintenanceOverlap(tx, trip.vehicleId, trip.plannedEnd, newEnd);
        }
        const updated = await tx.trip.updateMany({ where: { id: trip.id, version: input.version }, data: { plannedEnd: newEnd, version: { increment: 1 } } });
        if (updated.count !== 1) throw new Error("CONFLICT");
        const direction = input.minutes > 0 ? "延長" : "短縮";
        await tx.auditLog.create({ data: { operationId, ...auditActor, action: `利用時間${direction}`, targetType: "Trip", targetId: trip.id, description: `${Math.abs(input.minutes)}分${direction}` } });
      });
    }
    if (input.action === "setTripEnd") {
      await prisma.$transaction(async (tx) => {
        const trip = await lockTripForTimeChange(tx, input.tripId);
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
          await assertNoMaintenanceOverlap(tx, trip.vehicleId, trip.plannedEnd, newEnd);
        }
        const updated = await tx.trip.updateMany({ where: { id: trip.id, version: input.version, status: trip.status }, data: { plannedEnd: newEnd, version: { increment: 1 } } });
        if (updated.count !== 1) throw new Error("CONFLICT");
        await tx.auditLog.create({ data: { operationId, ...auditActor, action: "利用終了日時変更", targetType: "Trip", targetId: trip.id, description: `${trip.plannedEnd.toISOString()}から${newEnd.toISOString()}へ変更` } });
      });
    }
    if (input.action === "cancelTrip") {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.trip.updateMany({ where: { id: input.tripId, version: input.version, status: "RESERVED" }, data: { status: "CANCELLED", version: { increment: 1 } } });
        if (updated.count !== 1) throw new Error("予約済みの予定だけ取り消せます");
        await tx.auditLog.create({ data: { operationId, ...auditActor, action: "予約取消", targetType: "Trip", targetId: input.tripId, description: "タイムラインから予約を取り消し" } });
      });
    }
    if (input.action === "moveVehicle") {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`fleet-spot:${input.spotId}`}))::text AS spot_lock, pg_advisory_xact_lock(hashtext(${`fleet-vehicle:${input.vehicleId}`}))::text AS vehicle_lock`;
        const [target, movingVehicle] = await Promise.all([
          tx.parkingSpot.findUniqueOrThrow({ where: { id: input.spotId }, include: { vehicle: true } }),
          tx.vehicle.findUniqueOrThrow({ where: { id: input.vehicleId }, select: { status: true, active: true, parkingSpotId: true } }),
        ]);
        if (!movingVehicle.active) throw new Error("利用停止中の車両には駐車位置を設定できません");
        if (movingVehicle.status !== "AVAILABLE") throw new Error("利用中の車両には駐車位置を設定できません");
        if (!target.enabled) throw new Error("選択した駐車区画は利用できません");
        if (target.vehicle && target.vehicle.id !== input.vehicleId) throw new Error(`区画${target.code}は使用中です`);
        await assertSpotAllowsVehicle(tx, target, input.vehicleId);
        const updated = await tx.vehicle.updateMany({ where: { id: input.vehicleId, version: input.version }, data: { parkingSpotId: input.spotId, version: { increment: 1 } } });
        if (updated.count !== 1) throw new Error("CONFLICT");
        await tx.auditLog.create({ data: { operationId, ...auditActor, action: "駐車位置修正", targetType: "Vehicle", targetId: input.vehicleId, description: movingVehicle.parkingSpotId ? `区画${target.code}へ変更` : `区画${target.code}に配置` } });
      });
    }
    if (input.action === "updateSpot") {
      await prisma.$transaction(async (tx) => {
        // 番号の取り合いは区画番号用のロックで順番にする。
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('fleet-spot-codes'))::text AS spot_code_lock`;
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`fleet-spot:${input.id}`}))::text AS spot_lock`;
        const spot = await tx.parkingSpot.findUniqueOrThrow({ where: { id: input.id }, include: { vehicle: { select: { id: true, name: true } } } });
        const dedicatedVehicleId = input.role === "DEDICATED" ? input.dedicatedVehicleId : null;
        let dedicatedVehicleName: string | null = null;
        if (input.role === "DEDICATED") {
          if (!dedicatedVehicleId) throw new Error("専用にする車両を選んでください");
          const dedicated = await tx.vehicle.findUnique({ where: { id: dedicatedVehicleId }, select: { name: true, active: true } });
          if (!dedicated?.active) throw new Error("選択した車両は利用できません");
          if (spot.vehicle && spot.vehicle.id !== dedicatedVehicleId) throw new Error(`区画${spot.code}には${spot.vehicle.name}が駐車中です。先に移動してください`);
          dedicatedVehicleName = dedicated.name;
        }
        const codeChanged = spot.code !== input.code;
        const roleChanged = spot.role !== input.role || spot.dedicatedVehicleId !== dedicatedVehicleId;
        const labelChanged = spot.label !== input.label;
        if (!codeChanged && !roleChanged && !labelChanged) throw new Error("区画番号・用途・表示名は変更されていません");
        if (codeChanged) {
          const sameCode = await tx.parkingSpot.findUnique({ where: { code: input.code }, select: { id: true } });
          if (sameCode) throw new Error(`区画番号${input.code}はすでに使われています`);
        }
        const updated = await tx.parkingSpot.updateMany({ where: { id: input.id, version: input.version }, data: { code: input.code, role: input.role, dedicatedVehicleId, label: input.label, version: { increment: 1 } } });
        if (updated.count !== 1) throw new Error("CONFLICT");
        const previousName = spot.dedicatedVehicleId ? (await tx.vehicle.findUnique({ where: { id: spot.dedicatedVehicleId }, select: { name: true } }))?.name ?? null : null;
        const describe = (role: typeof input.role, name: string | null) => role === "DEDICATED" ? `${name ?? "車両未設定"}専用` : SPOT_ROLE_LABELS[role];
        const changes = [codeChanged ? `番号を${input.code}へ` : "", roleChanged ? `用途を「${describe(spot.role, previousName)}」から「${describe(input.role, dedicatedVehicleName)}」へ` : "", labelChanged ? `表示名を${input.label ? `「${input.label}」` : "自動"}へ` : ""].filter(Boolean).join("、");
        await tx.auditLog.create({ data: { operationId, actorName: "設定画面", action: "区画設定変更", targetType: "ParkingSpot", targetId: input.id, description: `区画${spot.code}の${changes}変更` } });
      });
    }
    if (input.action === "setFuelLevel") {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`fleet-vehicle:${input.vehicleId}`}))::text AS vehicle_lock`;
        const vehicle = await tx.vehicle.findUniqueOrThrow({ where: { id: input.vehicleId }, select: { name: true, active: true, parkingSpotId: true, fuelLevel: true } });
        if (!vehicle.active || !vehicle.parkingSpotId) throw new Error("駐車中の車両だけ残量を変更できます");
        if (vehicle.fuelLevel === input.fuelLevel) throw new Error("残量は変更されていません");
        const updated = await tx.vehicle.updateMany({ where: { id: input.vehicleId, version: input.version }, data: { fuelLevel: input.fuelLevel, version: { increment: 1 } } });
        if (updated.count !== 1) throw new Error("CONFLICT");
        await tx.auditLog.create({ data: { operationId, ...auditActor, action: "残量修正", targetType: "Vehicle", targetId: input.vehicleId, description: `${vehicle.name}の残量を${vehicle.fuelLevel === null ? "未登録" : formatFuelLevel(vehicle.fuelLevel)}から${formatFuelLevel(input.fuelLevel)}へ修正` } });
      });
    }
    if (input.action === "createDepartment") {
      await prisma.$transaction(async (tx) => {
        await lockDepartments(tx);
        const existing = await tx.department.findUnique({ where: { name: input.name }, select: { active: true } });
        if (existing) throw new Error(existing.active ? `部署「${input.name}」はすでに登録されています` : `部署「${input.name}」は利用停止中です。一覧から利用を再開してください`);
        const department = await tx.department.create({ data: { name: input.name, sortOrder: await nextDepartmentOrder(tx) } });
        await tx.auditLog.create({ data: { operationId, actorName: "設定画面", action: "部署登録", targetType: "Department", targetId: department.id, description: `部署「${input.name}」を登録` } });
      });
    }
    if (input.action === "renameDepartment") {
      await prisma.$transaction(async (tx) => {
        await lockDepartments(tx);
        const department = await tx.department.findUniqueOrThrow({ where: { id: input.id }, select: { name: true } });
        if (department.name === input.name) throw new Error("部署名は変更されていません");
        if (await tx.department.findUnique({ where: { name: input.name }, select: { id: true } })) throw new Error(`部署「${input.name}」はすでに登録されています`);
        const updated = await tx.department.updateMany({ where: { id: input.id, version: input.version }, data: { name: input.name, version: { increment: 1 } } });
        if (updated.count !== 1) throw new Error("CONFLICT");
        await tx.auditLog.create({ data: { operationId, actorName: "設定画面", action: "部署名変更", targetType: "Department", targetId: input.id, description: `部署名を「${department.name}」から「${input.name}」へ変更` } });
      });
    }
    if (input.action === "setDepartmentActive") {
      await prisma.$transaction(async (tx) => {
        await lockDepartments(tx);
        const department = await tx.department.findUniqueOrThrow({ where: { id: input.id }, select: { name: true, active: true } });
        if (department.active === input.active) throw new Error(input.active ? "この部署はすでに利用中です" : "この部署はすでに利用停止中です");
        if (!input.active) {
          const members = await tx.employee.count({ where: { departmentId: input.id, active: true } });
          if (members > 0) throw new Error(`部署「${department.name}」には有効な社員が${members}人所属しているため利用停止できません。先に社員の部署を変更してください`);
        }
        // 再開した部署は並び順の末尾に戻す。
        const updated = await tx.department.updateMany({ where: { id: input.id, version: input.version }, data: { active: input.active, ...(input.active ? { sortOrder: await nextDepartmentOrder(tx) } : {}), version: { increment: 1 } } });
        if (updated.count !== 1) throw new Error("CONFLICT");
        await tx.auditLog.create({ data: { operationId, actorName: "設定画面", action: input.active ? "部署利用再開" : "部署利用停止", targetType: "Department", targetId: input.id, description: `部署「${department.name}」の利用を${input.active ? "再開" : "停止"}` } });
      });
    }
    if (input.action === "moveDepartment") {
      await prisma.$transaction(async (tx) => {
        await lockDepartments(tx);
        const departments = await tx.department.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } });
        const index = departments.findIndex((department) => department.id === input.id);
        if (index < 0) throw new Error("利用停止中の部署は並べ替えできません");
        const target = index + (input.direction === "up" ? -1 : 1);
        if (target < 0 || target >= departments.length) throw new Error(input.direction === "up" ? "この部署はすでに先頭です" : "この部署はすでに末尾です");
        [departments[index], departments[target]] = [departments[target], departments[index]];
        for (const [position, department] of departments.entries()) await tx.department.update({ where: { id: department.id }, data: { sortOrder: position + 1 } });
        await tx.auditLog.create({ data: { operationId, actorName: "設定画面", action: "部署並べ替え", targetType: "Department", targetId: input.id, description: `部署「${departments[target].name}」を${input.direction === "up" ? "上" : "下"}へ移動` } });
      });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const duplicate = typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
    if (duplicate) {
      const completed = await prisma.auditLog.findUnique({ where: { operationId }, select: { id: true } });
      if (completed) return NextResponse.json({ ok: true, replayed: true });
    }
    const employeeAction = input.action === "createEmployee" || input.action === "updateEmployee" || input.action === "updateEmployeeNfc" || input.action === "rotateEmployeeQr" || input.action === "importEmployees";
    const departmentAction = input.action === "createDepartment" || input.action === "renameDepartment";
    const duplicateMessage = departmentAction ? "同じ名前の部署がすでに登録されています" : employeeAction ? "社員番号・メールアドレス・NFC UIDのいずれかがすでに登録されています" : "車両番号・ナンバー・NFC UIDのいずれかがすでに登録されています";
    const rawMessage = error instanceof Error ? error.message : "";
    const isConflict = rawMessage === "CONFLICT";
    const isBusinessMessage = rawMessage.length <= 200 && /[ぁ-んァ-ン一-龯]/.test(rawMessage);
    if (!duplicate && !isConflict && !isBusinessMessage) console.error("Dashboard action failed", { action: input.action, error });
    const message = duplicate ? duplicateMessage : isConflict ? "他のユーザーが先に更新しました。最新状態を再読込しました。" : isBusinessMessage ? rawMessage : "更新に失敗しました。再試行しても直らない場合は管理者へ連絡してください";
    return NextResponse.json({ message }, { status: isConflict ? 409 : 400 });
  } finally {
    activeOperationIds.delete(operationId);
  }
}
