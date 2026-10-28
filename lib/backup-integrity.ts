import type { FleetBackup } from "./json-backup";

// Match SQL constraints before starting a destructive restore transaction.
// Keep this independent of Prisma so invalid files fail before any DB writes.
export function validateBackupIntegrity(data: FleetBackup["data"]) {
  const fail = (message: string): never => { throw new Error(message); };
  const unique = (values: string[], label: string) => { if (new Set(values).size !== values.length) fail(`${label}が重複しています`); };
  unique(data.employees.filter((item) => item.active).map((item) => item.employeeNumberId), "有効な社員番号");
  unique(data.vehicles.filter((item) => item.active).map((item) => item.vehicleNumberId), "有効な車両番号");
  const activeAssignments = data.nfcAssignments.filter((item) => item.validTo === null);
  unique(activeAssignments.map((item) => item.nfcTagId), "有効なNFCタグ割当");
  unique(activeAssignments.flatMap((item) => item.employeeId ? [item.employeeId] : []), "社員への有効なNFC割当");
  unique(activeAssignments.flatMap((item) => item.vehicleId ? [item.vehicleId] : []), "車両への有効なNFC割当");
  for (const item of data.nfcAssignments) if (item.validTo && new Date(item.validTo) < new Date(item.validFrom)) fail("NFC割当の終了日時が開始日時より前です");
  const inUse = data.trips.filter((item) => item.status === "IN_USE");
  unique(inUse.map((item) => item.vehicleId), "利用中の車両");
  unique(inUse.map((item) => item.employeeId), "利用中の社員");
  const validState = (status: string, start: string | null, end: string | null) => {
    if (status === "IN_USE" || status === "ACTIVE") return start !== null && end === null;
    if (status === "COMPLETED") return start !== null && end !== null;
    return start === null && end === null;
  };
  for (const trip of data.trips) {
    if (!validState(trip.status, trip.actualStart, trip.actualEnd)) fail("利用状態と実際の開始・返却日時が一致しません");
    if (trip.actualEnd && (!trip.actualStart || new Date(trip.actualEnd) < new Date(trip.actualStart))) fail("実際の返却日時が利用開始より前です");
    const snapshot = [trip.snapshotCapturedAt, trip.employeeNameAtStart, trip.employeeCodeAtStart, trip.departmentNameAtStart, trip.vehicleNameAtStart, trip.vehicleCodeAtStart, trip.plateNumberAtStart];
    if (snapshot.some((value) => value !== null) && (!snapshot.every((value) => value !== null) || trip.actualStart === null)) fail("利用開始時点の登録情報が一部欠けています");
  }
  const usingVehicles = new Set(inUse.map((item) => item.vehicleId));
  for (const vehicle of data.vehicles) {
    if ((vehicle.status === "IN_USE") !== usingVehicles.has(vehicle.id)) fail("車両の利用状態と利用記録が一致しません");
  }
  unique(data.vehicleMaintenances.filter((item) => item.status === "ACTIVE").map((item) => item.vehicleId), "整備中の車両");
  for (const item of data.vehicleMaintenances) {
    if (item.plannedEnd && new Date(item.plannedEnd) <= new Date(item.plannedStart)) fail("整備の終了予定が開始予定以前です");
    if (!validState(item.status, item.actualStart, item.actualEnd)) fail("整備状態と実際の開始・終了日時が一致しません");
    if (item.actualEnd && (!item.actualStart || new Date(item.actualEnd) < new Date(item.actualStart))) fail("整備の終了日時が開始日時より前です");
  }
  for (const spot of data.parkingSpots) {
    if ((spot.role === "DEDICATED") !== (spot.dedicatedVehicleId != null)) fail("専用区画の用途と専用車両が一致しません");
  }
}
