import type { Prisma } from "@/prisma/generated/client";
import { csvText } from "./csv";
import { formatFuelLevel } from "./fuel-level";

export type VehicleHistoryVehicle = { id: string; name: string; plateNumber: string; active: boolean; vehicleNumber: { code: string } };
export type VehicleHistoryData = {
  records: { id: string; status: "IN_USE" | "COMPLETED"; actualStart: string; actualEnd: string | null; plannedEnd: string; returnFuelLevel: number | null;
    snapshotCapturedAt: string | null; employeeNameAtStart: string | null; employeeCodeAtStart: string | null; departmentNameAtStart: string | null;
    vehicleNameAtStart: string | null; vehicleCodeAtStart: string | null; plateNumberAtStart: string | null;
    vehicle: VehicleHistoryVehicle; employee: { name: string; employeeNumber: { code: string }; department: { name: string } } }[];
  vehicles: VehicleHistoryVehicle[];
  pagination: { page: number; pageCount: number; total: number };
};

export function vehicleHistoryPeriod(months: 1 | 3, now = new Date()) {
  const japan = new Date(now.getTime() + 9 * 60 * 60_000);
  const from = new Date(japan);
  const day = from.getUTCDate();
  from.setUTCDate(1);
  from.setUTCMonth(from.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0)).getUTCDate();
  from.setUTCDate(Math.min(day, lastDay));
  return { from: from.toISOString().slice(0, 16), to: japan.toISOString().slice(0, 16) };
}

// The search fields always use Japan time, regardless of the browser/server timezone.
function parseHistoryDate(value: string | null) {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("日時を正しく入力してください");
  const date = new Date(`${value}:00+09:00`);
  if (!Number.isFinite(date.getTime()) || new Date(date.getTime() + 9 * 60 * 60_000).toISOString().slice(0, 16) !== value) throw new Error("日時を正しく入力してください");
  return date;
}

export function vehicleHistoryQuery(params: URLSearchParams, now = new Date()) {
  const from = parseHistoryDate(params.get("from"));
  const to = parseHistoryDate(params.get("to"));
  if (from && to && from > to) throw new Error("終了日時は開始日時以降にしてください");
  const vehicleId = (params.get("vehicleId") ?? "").trim().slice(0, 100);
  const q = (params.get("q") ?? "").trim().slice(0, 100);
  const page = Math.min(10_000, Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1));
  const where: Prisma.TripWhereInput = {
    status: { in: ["IN_USE", "COMPLETED"] },
    actualStart: { not: null, lte: to && to < now ? to : now },
    ...(vehicleId ? { vehicleId } : {}),
    ...(q ? { AND: [{ OR: [
      { employeeNameAtStart: { contains: q, mode: "insensitive" } },
      { employee: { name: { contains: q, mode: "insensitive" } } },
    ] }] } : {}),
    ...(from ? { OR: [
      { actualEnd: { gt: from } },
      ...(from <= now ? [{ status: "IN_USE" as const, actualEnd: null }] : []),
    ] } : {}),
  };
  return { where, page };
}

type DateLike = string | Date;
type HistoryCsvTrip = Omit<VehicleHistoryData["records"][number], "status" | "actualStart" | "actualEnd" | "plannedEnd" | "snapshotCapturedAt"> & {
  status: string; actualStart: DateLike | null; actualEnd: DateLike | null; plannedEnd: DateLike; snapshotCapturedAt: DateLike | null;
};

// Japan time as "2026/10/30 22:20", regardless of the browser/server timezone.
export function formatHistoryDateTime(value: DateLike) {
  const japan = new Date(new Date(value).getTime() + 9 * 60 * 60_000).toISOString();
  return `${japan.slice(0, 10).replaceAll("-", "/")} ${japan.slice(11, 16)}`;
}

export const tripMinutes = (start: DateLike, end: DateLike) => Math.max(0, Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 60_000));

export function formatTripDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}時間${minutes % 60 ? `${minutes % 60}分` : ""}` : `${minutes}分`;
}

export function vehicleHistoryCsv(trips: HistoryCsvTrip[]) {
  return csvText([
    ["利用開始", "返却", "利用時間（分）", "状態", "車両名", "車両番号", "ナンバー", "社員番号", "利用者", "所属", "返却時のガソリン残量", "当時の登録情報"],
    ...trips.map((trip) => {
      const end = trip.status === "COMPLETED" ? trip.actualEnd : null;
      return [
        trip.actualStart ? formatHistoryDateTime(trip.actualStart) : "",
        end ? formatHistoryDateTime(end) : "",
        end && trip.actualStart ? tripMinutes(trip.actualStart, end) : "",
        end ? "返却済み" : "利用中",
        trip.vehicleNameAtStart ?? trip.vehicle.name,
        trip.vehicleCodeAtStart ?? trip.vehicle.vehicleNumber.code,
        trip.plateNumberAtStart ?? trip.vehicle.plateNumber,
        trip.employeeCodeAtStart ?? trip.employee.employeeNumber.code,
        trip.employeeNameAtStart ?? trip.employee.name,
        trip.departmentNameAtStart ?? trip.employee.department.name,
        end ? trip.returnFuelLevel === null ? "未記録" : formatFuelLevel(trip.returnFuelLevel) : "",
        trip.snapshotCapturedAt ? "保存済み" : "未保存（現在の情報）",
      ];
    }),
  ]);
}
