import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { vehicleHistoryQuery } from "@/lib/vehicle-history";

export const dynamic = "force-dynamic";
const vehicleSelect = { id: true, name: true, plateNumber: true, active: true, vehicleNumber: { select: { code: true } } } as const;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if (params.get("view") === "vehicles") {
    const vehicles = await prisma.vehicle.findMany({ orderBy: [{ vehicleNumber: { code: "asc" } }, { id: "asc" }], select: vehicleSelect });
    return NextResponse.json({ vehicles }, { headers: { "Cache-Control": "no-store" } });
  }
  let query: ReturnType<typeof vehicleHistoryQuery>;
  try { query = vehicleHistoryQuery(params); }
  catch (error) { return NextResponse.json({ message: (error as Error).message }, { status: 400 }); }
  const { where, page } = query;
  const pageSize = 50;
  const [records, total, vehicles] = await Promise.all([
    prisma.trip.findMany({ where, orderBy: [{ actualStart: "desc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize,
      select: { id: true, status: true, actualStart: true, actualEnd: true, plannedEnd: true, returnFuelLevel: true,
        snapshotCapturedAt: true, employeeNameAtStart: true, employeeCodeAtStart: true, departmentNameAtStart: true,
        vehicleNameAtStart: true, vehicleCodeAtStart: true, plateNumberAtStart: true,
        vehicle: { select: vehicleSelect }, employee: { select: { name: true, employeeNumber: { select: { code: true } }, department: { select: { name: true } } } } },
    }),
    prisma.trip.count({ where }),
    // Inactive vehicles remain searchable for past trips.
    prisma.vehicle.findMany({ orderBy: [{ vehicleNumber: { code: "asc" } }, { id: "asc" }], select: vehicleSelect }),
  ]);
  return NextResponse.json({ records, vehicles, pagination: { page, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) } }, { headers: { "Cache-Control": "no-store" } });
}
