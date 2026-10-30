import type { ParkingSpotRole } from "@/lib/parking-spots";
import type { MaintenanceKind } from "@/lib/maintenance";

export type Employee = { id: string; code: string; name: string; email: string; department: string; nfcUid: string; qrCode: string; active: boolean; version: number };
// employeeCountは有効な社員の人数。並び順はAPIが返す配列の順番。
export type Department = { id: string; name: string; active: boolean; version: number; employeeCount: number };
export type Vehicle = {
  id: string; code: string; name: string; plateNumber: string; nfcUid: string; qrCode: string;
  hasEtc: boolean; hasNavigation: boolean; hasWinterTires: boolean; hasBackMonitor: boolean; isKei: boolean; fuelCard: string; fuelLevel: number | null;
  color: string; status: "AVAILABLE" | "RESERVED" | "IN_USE" | "MAINTENANCE";
  parkingSpotId: string | null; active: boolean; version: number;
};
export type ParkingSpot = {
  id: string; code: string; x: number; y: number; width: number; height: number;
  orientation: string; enabled: boolean; version: number; vehicle: Vehicle | null;
  role: ParkingSpotRole; dedicatedVehicleId: string | null; dedicatedVehicleName: string | null; label: string | null;
};
export type Trip = {
  id: string; employeeId: string; vehicleId: string; plannedStart: string; plannedEnd: string;
  actualStart: string | null; actualEnd: string | null; status: "RESERVED" | "IN_USE" | "COMPLETED" | "CANCELLED";
  purpose: string | null; returnSpotCode: string | null; returnFuelLevel: number | null; version: number;
  employee: Employee; vehicle: Vehicle;
};
// 整備の記録。ACTIVEのOFF_SITEは車検・修理で外出中で、車両のparkingSpotIdは空ける（以前の仕様で外出した車両は区画を持ったまま）。plannedEndは戻り予定。
export type VehicleMaintenance = {
  id: string; vehicleId: string; kind: MaintenanceKind; status: "SCHEDULED" | "ACTIVE" | "COMPLETED" | "CANCELLED";
  note: string | null; plannedStart: string; plannedEnd: string | null; actualStart: string | null; actualEnd: string | null;
  returnSpotCode: string | null; version: number;
};
export type DashboardData = { employees: Employee[]; departments: Department[]; vehicles: Vehicle[]; spots: ParkingSpot[]; trips: Trip[]; nextReservations: Trip[]; maintenances: VehicleMaintenance[]; system: { backupLatestAt: string | null; backupVerifiedAt: string | null; appVersion: string; environment: string; deployedAt: string | null; schemaVersion: string } };
