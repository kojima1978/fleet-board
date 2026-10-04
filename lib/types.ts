export type Employee = { id: string; code: string; name: string; department: string; nfcUid: string; active: boolean; version: number };
export type Department = { id: string; name: string; active: boolean };
export type Vehicle = {
  id: string; code: string; name: string; plateNumber: string; nfcUid: string;
  color: string; status: "AVAILABLE" | "RESERVED" | "IN_USE" | "MAINTENANCE";
  parkingSpotId: string | null; active: boolean; version: number;
};
export type ParkingSpot = {
  id: string; code: string; x: number; y: number; width: number; height: number;
  orientation: string; enabled: boolean; version: number; vehicle: Vehicle | null;
};
export type Trip = {
  id: string; employeeId: string; vehicleId: string; plannedStart: string; plannedEnd: string;
  actualStart: string | null; actualEnd: string | null; status: "RESERVED" | "IN_USE" | "COMPLETED" | "CANCELLED";
  purpose: string | null; returnSpotCode: string | null; version: number;
  employee: Employee; vehicle: Vehicle;
};
export type DashboardData = { employees: Employee[]; departments: Department[]; vehicles: Vehicle[]; spots: ParkingSpot[]; trips: Trip[] };
