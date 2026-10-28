import type { Prisma } from "@/prisma/generated/client";

export async function captureTripStartSnapshot(tx: Prisma.TransactionClient, employeeId: string, vehicleId: string, capturedAt: Date) {
  const [employee, vehicle] = await Promise.all([
    tx.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { name: true, employeeNumber: { select: { code: true } }, department: { select: { name: true } } } }),
    tx.vehicle.findUniqueOrThrow({ where: { id: vehicleId }, select: { name: true, plateNumber: true, vehicleNumber: { select: { code: true } } } }),
  ]);
  return { snapshotCapturedAt: capturedAt, employeeNameAtStart: employee.name, employeeCodeAtStart: employee.employeeNumber.code,
    departmentNameAtStart: employee.department.name, vehicleNameAtStart: vehicle.name, vehicleCodeAtStart: vehicle.vehicleNumber.code, plateNumberAtStart: vehicle.plateNumber };
}
