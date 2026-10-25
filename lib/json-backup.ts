import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getApplicationSystemStatus } from "@/lib/system-status";
import { FUEL_LEVEL_MAX } from "@/lib/fuel-level";
import { upgradeLegacyCodes } from "@/lib/record-codes";
import { defaultSpotRoles } from "@/prisma/parking-spot-seed";
import { createQrToken } from "@/lib/qr-code";

export const JSON_BACKUP_FORMAT_VERSION = 1;
export const JSON_BACKUP_MAX_BYTES = 50 * 1024 * 1024;

const id = z.string().min(1).max(100);
const dateTime = z.string().datetime();
const nullableDateTime = dateTime.nullable();

const departmentSchema = z.object({ id, name: z.string().min(1).max(100), active: z.boolean(), sortOrder: z.number().int().optional(), version: z.number().int().nonnegative().optional(), createdAt: dateTime, updatedAt: dateTime }).strict();
const employeeNumberSchema = z.object({ id, code: z.string().min(1).max(100), createdAt: dateTime, updatedAt: dateTime }).strict();
const vehicleNumberSchema = z.object({ id, code: z.string().min(1).max(100), createdAt: dateTime, updatedAt: dateTime }).strict();
const parkingSpotSchema = z.object({ id, code: z.string().min(1).max(100), x: z.number().finite(), y: z.number().finite(), width: z.number().finite().positive(), height: z.number().finite().positive(), orientation: z.string().min(1).max(50), enabled: z.boolean(), role: z.enum(["REGULAR", "TEMPORARY", "CUSTOMER", "DEDICATED", "HOLDING"]).optional(), dedicatedVehicleId: id.nullable().optional(), label: z.string().max(100).nullable().optional(), version: z.number().int().nonnegative() }).strict();
const nfcTagSchema = z.object({ id, uid: z.string().min(1).max(100), createdAt: dateTime, updatedAt: dateTime }).strict();
const employeeSchema = z.object({ id, employeeNumberId: id, departmentId: id, name: z.string().min(1).max(100), email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()).nullable().optional(), qrToken: z.string().min(16).max(100).optional(), active: z.boolean(), version: z.number().int().nonnegative(), createdAt: dateTime, updatedAt: dateTime }).strict();
const fuelLevelSchema = z.number().int().min(0).max(FUEL_LEVEL_MAX).nullable().optional();
const vehicleSchema = z.object({ id, vehicleNumberId: id, name: z.string().min(1).max(100), qrToken: z.string().min(16).max(100).optional(), plateNumber: z.string().min(1).max(100), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), hasEtc: z.boolean(), hasNavigation: z.boolean(), fuelLevel: fuelLevelSchema, active: z.boolean(), status: z.enum(["AVAILABLE", "RESERVED", "IN_USE", "MAINTENANCE"]), parkingSpotId: id.nullable(), version: z.number().int().nonnegative(), createdAt: dateTime, updatedAt: dateTime }).strict();
// clearedを追加する前のバックアップにはないため、UIDを消して外していない割り当てとして読む。
const nfcAssignmentSchema = z.object({ id, employeeId: id.nullable(), vehicleId: id.nullable(), nfcTagId: id, validFrom: dateTime, validTo: nullableDateTime, cleared: z.boolean().default(false), createdAt: dateTime }).strict();
const tripSchema = z.object({ id, employeeId: id, vehicleId: id, plannedStart: dateTime, plannedEnd: dateTime, actualStart: nullableDateTime, actualEnd: nullableDateTime, returnSpotCode: z.string().max(100).nullable(), returnFuelLevel: fuelLevelSchema, previousFuelLevel: fuelLevelSchema, purpose: z.string().max(500).nullable(), status: z.enum(["RESERVED", "IN_USE", "COMPLETED", "CANCELLED"]), version: z.number().int().nonnegative(), createdAt: dateTime, updatedAt: dateTime }).strict();
const vehicleMaintenanceSchema = z.object({ id, vehicleId: id, kind: z.enum(["ON_SITE", "OFF_SITE"]), status: z.enum(["SCHEDULED", "ACTIVE", "COMPLETED", "CANCELLED"]), note: z.string().max(500).nullable(), plannedStart: dateTime, plannedEnd: nullableDateTime, actualStart: nullableDateTime, actualEnd: nullableDateTime, returnSpotCode: z.string().max(100).nullable(), version: z.number().int().nonnegative(), createdAt: dateTime, updatedAt: dateTime }).strict();
const auditLogSchema = z.object({ id, operationId: z.string().max(100).nullable(), actorEmployeeId: id.nullable(), actorName: z.string().max(100), action: z.string().max(100), targetType: z.string().max(100), targetId: z.string().max(100), description: z.string().max(1000), createdAt: dateTime }).strict();

export const fleetBackupSchema = z.object({
  format: z.literal("fleetflow-json-backup"),
  formatVersion: z.literal(JSON_BACKUP_FORMAT_VERSION),
  exportedAt: dateTime,
  source: z.object({ appVersion: z.string().max(100), schemaVersion: z.string().max(200) }).strict(),
  data: z.object({
    departments: z.array(departmentSchema).max(1_000),
    employeeNumbers: z.array(employeeNumberSchema).max(20_000),
    vehicleNumbers: z.array(vehicleNumberSchema).max(20_000),
    parkingSpots: z.array(parkingSpotSchema).max(2_000),
    nfcTags: z.array(nfcTagSchema).max(50_000),
    employees: z.array(employeeSchema).max(20_000),
    vehicles: z.array(vehicleSchema).max(20_000),
    nfcAssignments: z.array(nfcAssignmentSchema).max(100_000),
    trips: z.array(tripSchema).max(200_000),
    // 整備記録を追加する前のバックアップにはないため、空として読む。
    vehicleMaintenances: z.array(vehicleMaintenanceSchema).max(100_000).default([]),
    auditLogs: z.array(auditLogSchema).max(300_000),
  }).strict(),
}).strict();

export type FleetBackup = z.infer<typeof fleetBackupSchema>;
export type FleetBackupCounts = Record<keyof FleetBackup["data"], number>;

export class FleetBackupValidationError extends Error {}

function assertUnique<T>(items: T[], valueOf: (item: T) => string | null, label: string) {
  const values = new Set<string>();
  for (const item of items) {
    const value = valueOf(item);
    if (value === null) continue;
    if (values.has(value)) throw new FleetBackupValidationError(`${label}「${value}」が重複しています`);
    values.add(value);
  }
}

function assertReference(available: Set<string>, value: string | null, label: string) {
  if (value !== null && !available.has(value)) throw new FleetBackupValidationError(`${label}の参照先「${value}」が見つかりません`);
}

// 割り当て先の番号と同じ英字・同じ数のタグだけを変え、同じUIDがすでにあれば残す。
function upgradeDummyNfcUids(data: FleetBackup["data"]) {
  const employeeCodes = new Map(data.employeeNumbers.map((item) => [item.id, item.code]));
  const vehicleCodes = new Map(data.vehicleNumbers.map((item) => [item.id, item.code]));
  const employeeCodeById = new Map(data.employees.map((item) => [item.id, employeeCodes.get(item.employeeNumberId)]));
  const vehicleCodeById = new Map(data.vehicles.map((item) => [item.id, vehicleCodes.get(item.vehicleNumberId)]));
  const ownerCodes = new Map<string, Set<string>>();
  for (const assignment of data.nfcAssignments) {
    const code = assignment.employeeId ? employeeCodeById.get(assignment.employeeId) : assignment.vehicleId ? vehicleCodeById.get(assignment.vehicleId) : undefined;
    if (code) ownerCodes.set(assignment.nfcTagId, (ownerCodes.get(assignment.nfcTagId) ?? new Set()).add(code));
  }
  const taken = new Set(data.nfcTags.map((tag) => tag.uid));
  const renamed = new Map<string, string>();
  for (const tag of [...data.nfcTags].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const match = /^NFC-([A-Z])(\d{1,2})$/.exec(tag.uid);
    const uid = match ? `NFC-${match[1]}${match[2].padStart(3, "0")}` : "";
    if (!uid || taken.has(uid) || !ownerCodes.get(tag.id)?.has(uid.slice(4))) continue;
    taken.add(uid);
    renamed.set(tag.id, uid);
  }
  return data.nfcTags.map((tag) => (renamed.has(tag.id) ? { ...tag, uid: renamed.get(tag.id)! } : tag));
}

export function parseFleetBackup(value: unknown): FleetBackup {
  const parsed = fleetBackupSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const location = issue?.path.length ? issue.path.join(".") : "JSON";
    throw new FleetBackupValidationError(`${location}: ${issue?.message ?? "バックアップ形式が正しくありません"}`);
  }
  const backup = parsed.data;
  const data = backup.data;
  // QR導入前のバックアップにはトークンがないため、復元時にだけ新しい不変トークンを割り当てる。
  data.employees = data.employees.map((item) => ({ ...item, qrToken: item.qrToken ?? createQrToken() }));
  data.vehicles = data.vehicles.map((item) => ({ ...item, qrToken: item.qrToken ?? createQrToken() }));
  // 形式を固定する前のバックアップ（C01など）も、今のDBと同じ英字1文字＋3桁の番号へ置き換えて復元する。
  // どの社員・車両にも使われていない番号は戻さず、仮のNFC UID（NFC-C02など）は割り当て先の番号に合わせる。
  // DBの移行（20261027100000_fix_record_code_format）と同じ規則にする。
  const usedEmployeeNumberIds = new Set(data.employees.map((item) => item.employeeNumberId));
  const usedVehicleNumberIds = new Set(data.vehicles.map((item) => item.vehicleNumberId));
  try {
    data.employeeNumbers = upgradeLegacyCodes(data.employeeNumbers.filter((item) => usedEmployeeNumberIds.has(item.id)), "employee");
    data.vehicleNumbers = upgradeLegacyCodes(data.vehicleNumbers.filter((item) => usedVehicleNumberIds.has(item.id)), "vehicle");
  } catch (error) {
    throw new FleetBackupValidationError(error instanceof Error ? error.message : "番号を変換できません");
  }
  data.nfcTags = upgradeDummyNfcUids(data);
  const collections = Object.entries(data) as [keyof typeof data, Array<{ id: string }>][];
  for (const [name, items] of collections) assertUnique(items, (item) => item.id, `${name}のID`);
  assertUnique(data.departments, (item) => item.name, "部署名");
  assertUnique(data.employeeNumbers, (item) => item.code, "社員番号");
  assertUnique(data.vehicleNumbers, (item) => item.code, "車両番号");
  assertUnique(data.parkingSpots, (item) => item.code, "駐車区画番号");
  assertUnique(data.nfcTags, (item) => item.uid, "NFC UID");
  assertUnique(data.employees, (item) => item.qrToken ?? null, "社員QRトークン");
  assertUnique(data.vehicles, (item) => item.qrToken ?? null, "車両QRトークン");
  assertUnique(data.vehicles, (item) => item.plateNumber, "ナンバー");
  assertUnique(data.vehicles, (item) => item.parkingSpotId, "車両の駐車区画");
  assertUnique(data.auditLogs, (item) => item.operationId, "操作ID");

  const departmentIds = new Set(data.departments.map((item) => item.id));
  const employeeNumberIds = new Set(data.employeeNumbers.map((item) => item.id));
  const vehicleNumberIds = new Set(data.vehicleNumbers.map((item) => item.id));
  const parkingSpotIds = new Set(data.parkingSpots.map((item) => item.id));
  const nfcTagIds = new Set(data.nfcTags.map((item) => item.id));
  const employeeIds = new Set(data.employees.map((item) => item.id));
  const vehicleIds = new Set(data.vehicles.map((item) => item.id));
  for (const employee of data.employees) {
    assertReference(employeeNumberIds, employee.employeeNumberId, "社員番号");
    assertReference(departmentIds, employee.departmentId, "部署");
  }
  for (const vehicle of data.vehicles) {
    assertReference(vehicleNumberIds, vehicle.vehicleNumberId, "車両番号");
    assertReference(parkingSpotIds, vehicle.parkingSpotId, "駐車区画");
  }
  for (const spot of data.parkingSpots) assertReference(vehicleIds, spot.dedicatedVehicleId ?? null, "専用区画の車両");
  for (const assignment of data.nfcAssignments) {
    if ((assignment.employeeId === null) === (assignment.vehicleId === null)) throw new FleetBackupValidationError("NFC割当は社員または車両のどちらか一方を参照する必要があります");
    assertReference(employeeIds, assignment.employeeId, "NFC割当の社員");
    assertReference(vehicleIds, assignment.vehicleId, "NFC割当の車両");
    assertReference(nfcTagIds, assignment.nfcTagId, "NFCタグ");
  }
  for (const trip of data.trips) {
    assertReference(employeeIds, trip.employeeId, "利用履歴の社員");
    assertReference(vehicleIds, trip.vehicleId, "利用履歴の車両");
    if (new Date(trip.plannedEnd) <= new Date(trip.plannedStart)) throw new FleetBackupValidationError(`利用履歴「${trip.id}」の終了日時が開始日時以前です`);
  }
  for (const maintenance of data.vehicleMaintenances) assertReference(vehicleIds, maintenance.vehicleId, "整備記録の車両");
  for (const log of data.auditLogs) assertReference(employeeIds, log.actorEmployeeId, "操作履歴の社員");
  return backup;
}

export function backupCounts(backup: FleetBackup): FleetBackupCounts {
  return Object.fromEntries(Object.entries(backup.data).map(([name, items]) => [name, items.length])) as FleetBackupCounts;
}

export async function createFleetBackup(): Promise<FleetBackup> {
  const systemPromise = getApplicationSystemStatus();
  const data = await prisma.$transaction(async (tx) => {
    const [departments, employeeNumbers, vehicleNumbers, parkingSpots, nfcTags, employees, vehicles, nfcAssignments, trips, vehicleMaintenances, auditLogs] = await Promise.all([
      tx.department.findMany({ orderBy: { id: "asc" } }),
      tx.employeeNumber.findMany({ orderBy: { id: "asc" } }),
      tx.vehicleNumber.findMany({ orderBy: { id: "asc" } }),
      tx.parkingSpot.findMany({ orderBy: { id: "asc" } }),
      tx.nfcTag.findMany({ orderBy: { id: "asc" } }),
      tx.employee.findMany({ orderBy: { id: "asc" } }),
      tx.vehicle.findMany({ orderBy: { id: "asc" } }),
      tx.nfcAssignment.findMany({ orderBy: { id: "asc" } }),
      tx.trip.findMany({ orderBy: { id: "asc" } }),
      tx.vehicleMaintenance.findMany({ orderBy: { id: "asc" } }),
      tx.auditLog.findMany({ orderBy: { id: "asc" } }),
    ]);
    return { departments, employeeNumbers, vehicleNumbers, parkingSpots, nfcTags, employees, vehicles, nfcAssignments, trips, vehicleMaintenances, auditLogs };
  }, { isolationLevel: "RepeatableRead", timeout: 30_000 });
  const system = await systemPromise;
  return JSON.parse(JSON.stringify({ format: "fleetflow-json-backup", formatVersion: JSON_BACKUP_FORMAT_VERSION, exportedAt: new Date().toISOString(), source: { appVersion: system.appVersion, schemaVersion: system.schemaVersion }, data })) as FleetBackup;
}

const asDate = (value: string) => new Date(value);
// 役割を持たない以前のバックアップは、当時コードで固定していた役割で復元する。
const legacySpotRole = (code: string, data: FleetBackup["data"]) => {
  if (code === "19") {
    const numberId = data.vehicleNumbers.find((item) => item.code === "C007")?.id;
    const sakura = data.vehicles.filter((vehicle) => vehicle.vehicleNumberId === numberId).sort((a, b) => Number(b.active) - Number(a.active) || b.createdAt.localeCompare(a.createdAt))[0];
    if (sakura) return { role: "DEDICATED" as const, dedicatedVehicleId: sakura.id };
  }
  return { role: defaultSpotRoles[code] ?? "REGULAR" as const };
};
const asNullableDate = (value: string | null) => value ? new Date(value) : null;

export async function restoreFleetBackup(backup: FleetBackup) {
  const data = backup.data;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('fleetflow-json-restore'))::text AS restore_lock`;
    await tx.$executeRawUnsafe('LOCK TABLE "AuditLog", "NfcAssignment", "Trip", "VehicleMaintenance", "Employee", "Vehicle", "NfcTag", "EmployeeNumber", "VehicleNumber", "Department", "ParkingSpot" IN ACCESS EXCLUSIVE MODE');
    await tx.auditLog.deleteMany();
    await tx.nfcAssignment.deleteMany();
    await tx.trip.deleteMany();
    await tx.vehicleMaintenance.deleteMany();
    await tx.employee.deleteMany();
    await tx.vehicle.deleteMany();
    await tx.nfcTag.deleteMany();
    await tx.employeeNumber.deleteMany();
    await tx.vehicleNumber.deleteMany();
    await tx.department.deleteMany();
    await tx.parkingSpot.deleteMany();

    if (data.departments.length) await tx.department.createMany({ data: data.departments.map((item) => ({ ...item, createdAt: asDate(item.createdAt), updatedAt: asDate(item.updatedAt) })) });
    if (data.employeeNumbers.length) await tx.employeeNumber.createMany({ data: data.employeeNumbers.map((item) => ({ ...item, createdAt: asDate(item.createdAt), updatedAt: asDate(item.updatedAt) })) });
    if (data.vehicleNumbers.length) await tx.vehicleNumber.createMany({ data: data.vehicleNumbers.map((item) => ({ ...item, createdAt: asDate(item.createdAt), updatedAt: asDate(item.updatedAt) })) });
    if (data.parkingSpots.length) await tx.parkingSpot.createMany({ data: data.parkingSpots.map((item) => ({ ...item, ...(item.role === undefined ? legacySpotRole(item.code, data) : {}) })) });
    if (data.nfcTags.length) await tx.nfcTag.createMany({ data: data.nfcTags.map((item) => ({ ...item, createdAt: asDate(item.createdAt), updatedAt: asDate(item.updatedAt) })) });
    if (data.employees.length) await tx.employee.createMany({ data: data.employees.map((item) => ({ ...item, qrToken: item.qrToken!, createdAt: asDate(item.createdAt), updatedAt: asDate(item.updatedAt) })) });
    if (data.vehicles.length) await tx.vehicle.createMany({ data: data.vehicles.map((item) => ({ ...item, qrToken: item.qrToken!, createdAt: asDate(item.createdAt), updatedAt: asDate(item.updatedAt) })) });
    if (data.nfcAssignments.length) await tx.nfcAssignment.createMany({ data: data.nfcAssignments.map((item) => ({ ...item, validFrom: asDate(item.validFrom), validTo: asNullableDate(item.validTo), createdAt: asDate(item.createdAt) })) });
    if (data.trips.length) await tx.trip.createMany({ data: data.trips.map((item) => ({ ...item, plannedStart: asDate(item.plannedStart), plannedEnd: asDate(item.plannedEnd), actualStart: asNullableDate(item.actualStart), actualEnd: asNullableDate(item.actualEnd), createdAt: asDate(item.createdAt), updatedAt: asDate(item.updatedAt) })) });
    if (data.vehicleMaintenances.length) await tx.vehicleMaintenance.createMany({ data: data.vehicleMaintenances.map((item) => ({ ...item, plannedStart: asDate(item.plannedStart), plannedEnd: asNullableDate(item.plannedEnd), actualStart: asNullableDate(item.actualStart), actualEnd: asNullableDate(item.actualEnd), createdAt: asDate(item.createdAt), updatedAt: asDate(item.updatedAt) })) });
    if (data.auditLogs.length) await tx.auditLog.createMany({ data: data.auditLogs.map((item) => ({ ...item, createdAt: asDate(item.createdAt) })) });
    await tx.auditLog.create({ data: { operationId: randomUUID(), actorName: "設定画面", action: "JSON一括復元", targetType: "System", targetId: backup.exportedAt, description: `${backup.exportedAt}に書き出したJSONバックアップを復元` } });
  }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 120_000 });
}
