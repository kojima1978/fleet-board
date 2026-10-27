export type StartTimeRecord = {
  id: string; version: number; status: string; plannedStart: string; plannedEnd: string;
  actualStart: string | null; actualEnd: string | null;
  vehicle: { name: string }; employee: { name: string };
};

export function validateReservationStart(start: Date, end: Date, now: Date) {
  if (!Number.isFinite(start.getTime()) || start <= now) throw new Error("開始予定は現在時刻より後にしてください");
  if (!Number.isFinite(end.getTime())) throw new Error("終了予定を確認してください");
  const minutes = (end.getTime() - start.getTime()) / 60_000;
  if (minutes < 15 || minutes > 10_080) throw new Error("利用時間は15分以上7日以内にしてください");
}

export function validateActualStart(trip: { status: string; actualStart: Date | null; actualEnd: Date | null }, start: Date, reason: string, now: Date) {
  if (!["IN_USE", "COMPLETED"].includes(trip.status) || !trip.actualStart) throw new Error("利用開始済みの記録だけ訂正できます");
  if (!reason.trim() || reason.trim().length > 200) throw new Error("訂正理由を200文字以内で入力してください");
  if (!Number.isFinite(start.getTime()) || start > now) throw new Error("実際の開始時刻は現在以前にしてください");
  if (trip.status === "COMPLETED" && (!trip.actualEnd || start >= trip.actualEnd)) throw new Error("開始時刻は実際の返却時刻より前にしてください");
  if (start.getTime() === trip.actualStart.getTime()) throw new Error("変更後の開始時刻を指定してください");
}

export function tripOverlaps(trip: { status: string; actualStart: Date | null; actualEnd: Date | null; plannedStart: Date; plannedEnd: Date }, start: Date, end: Date) {
  const otherStart = trip.status === "RESERVED" ? trip.plannedStart : trip.actualStart ?? trip.plannedStart;
  const otherEnd = trip.status === "IN_USE" ? Infinity : (trip.status === "RESERVED" ? trip.plannedEnd : trip.actualEnd ?? trip.plannedEnd).getTime();
  return otherStart < end && otherEnd > start.getTime();
}
