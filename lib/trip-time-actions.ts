import { prisma } from "./prisma";
import { tripOverlaps, validateActualStart, validateReservationStart } from "./trip-times";

type Input = { action: "setReservationStart"; tripId: string; version: number; plannedStart: string } |
  { action: "correctActualStart"; tripId: string; version: number; actualStart: string; reason: string };

export async function updateTripStart(input: Input, operationId: string, actor: { actorEmployeeId: string | null; actorName: string }) {
  if (input.action === "correctActualStart" && !actor.actorEmployeeId) throw new Error("訂正する利用者を選択してください");
  await prisma.$transaction(async (tx) => {
    const initial = await tx.trip.findUniqueOrThrow({ where: { id: input.tripId } });
    // 利用開始・予約と同じ社員→車両の順でロックし、並行更新と競合検査を直列化する。
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`fleet-employee:${initial.employeeId}`}))::text AS employee_lock, pg_advisory_xact_lock(hashtext(${`fleet-vehicle:${initial.vehicleId}`}))::text AS vehicle_lock`;
    if (await tx.auditLog.findUnique({ where: { operationId }, select: { id: true } })) return;
    const trip = await tx.trip.findUniqueOrThrow({ where: { id: input.tripId }, include: { vehicle: { select: { name: true } } } });
    if (trip.version !== input.version) throw new Error("CONFLICT");
    const now = new Date();
    const start = new Date(input.action === "setReservationStart" ? input.plannedStart : input.actualStart);
    if (input.action === "setReservationStart") {
      if (trip.status !== "RESERVED") throw new Error("予約の開始予定だけ変更できます");
      validateReservationStart(start, trip.plannedEnd, now);
      if (start.getTime() === trip.plannedStart.getTime()) throw new Error("変更後の開始日時を指定してください");
    } else validateActualStart(trip, start, input.reason, now);
    const end = input.action === "setReservationStart" ? trip.plannedEnd : trip.actualEnd ?? now;
    const candidates = await tx.trip.findMany({ where: {
      id: { not: trip.id }, status: { in: ["RESERVED", "IN_USE", "COMPLETED"] },
      OR: [{ vehicleId: trip.vehicleId }, { employeeId: trip.employeeId }],
    }, select: { status: true, actualStart: true, actualEnd: true, plannedStart: true, plannedEnd: true } });
    if (candidates.some((other) => input.action === "setReservationStart" && other.status === "COMPLETED" ? false : tripOverlaps(other, start, end))) {
      throw new Error("車両または利用者の別の利用・予約と重なっています");
    }
    if (input.action === "setReservationStart") {
      const maintenance = await tx.vehicleMaintenance.findFirst({ where: {
        vehicleId: trip.vehicleId, status: { in: ["SCHEDULED", "ACTIVE"] }, plannedStart: { lt: end },
        OR: [{ plannedEnd: null }, { plannedEnd: { gt: start } }],
      } });
      if (maintenance) throw new Error("車両の整備予定と重なっています");
    }
    const updated = await tx.trip.updateMany({ where: { id: trip.id, version: input.version, status: trip.status }, data: {
      ...(input.action === "setReservationStart" ? { plannedStart: start } : { actualStart: start }), version: { increment: 1 },
    } });
    if (updated.count !== 1) throw new Error("CONFLICT");
    const before = input.action === "setReservationStart" ? trip.plannedStart : trip.actualStart!;
    await tx.auditLog.create({ data: {
      operationId, ...actor, action: input.action === "setReservationStart" ? "予約開始予定変更" : "利用開始時刻訂正", targetType: "Trip", targetId: trip.id,
      description: `${trip.vehicle.name}: ${before.toISOString()} → ${start.toISOString()}${input.action === "correctActualStart" ? ` / 訂正理由: ${input.reason.trim()}` : "（終了予定は変更なし）"}`,
    } });
  });
}
