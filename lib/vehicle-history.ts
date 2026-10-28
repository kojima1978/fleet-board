import type { Prisma } from "@/prisma/generated/client";

export type VehicleHistoryVehicle = { id: string; name: string; plateNumber: string; active: boolean; vehicleNumber: { code: string } };
export type VehicleHistoryData = {
  records: { id: string; status: "IN_USE" | "COMPLETED"; actualStart: string; actualEnd: string | null; plannedEnd: string;
    vehicle: VehicleHistoryVehicle; employee: { name: string; employeeNumber: { code: string } } }[];
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
    ...(q ? { employee: { name: { contains: q, mode: "insensitive" } } } : {}),
    ...(from ? { OR: [
      { actualEnd: { gt: from } },
      ...(from <= now ? [{ status: "IN_USE" as const, actualEnd: null }] : []),
    ] } : {}),
  };
  return { where, page };
}
