import type { ParkingSpot, Trip, Vehicle } from "./types";
import { RESERVATION_GRACE_MINUTES } from "./reservations";

export const PARKING_RESERVATION_NOTICE_MINUTES = 30;
export type ParkingReservation = {
  trip: Trip;
  vehicle: Vehicle;
  spotCode: string | null;
  inUse: boolean;
  waiting: boolean;
};

// 表示専用。予約の開始前に車両・駐車区画・利用状態を変更しない。
export function getParkingReservations(trips: Trip[], vehicles: Vehicle[], spots: ParkingSpot[], now: number): ParkingReservation[] {
  const currentVehicles = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const occupied = new Map(spots.filter((spot) => spot.vehicle).map((spot) => [spot.vehicle!.id, spot.code]));
  const inUse = new Set(trips.filter((trip) => trip.status === "IN_USE").map((trip) => trip.vehicleId));
  const seen = new Set<string>();
  return trips.flatMap((trip): ParkingReservation[] => {
    const start = Date.parse(trip.plannedStart);
    const end = Date.parse(trip.plannedEnd);
    const vehicle = currentVehicles.get(trip.vehicleId);
    if (trip.status !== "RESERVED" || !vehicle?.active || !trip.employee.active || seen.has(trip.id) ||
      !Number.isFinite(start) || !Number.isFinite(end) ||
      now < start - PARKING_RESERVATION_NOTICE_MINUTES * 60_000 ||
      now >= Math.min(end, start + RESERVATION_GRACE_MINUTES * 60_000)) return [];
    seen.add(trip.id);
    const currentlyInUse = inUse.has(vehicle.id) || vehicle.status === "IN_USE";
    return [{ trip, vehicle, spotCode: currentlyInUse ? null : occupied.get(vehicle.id) ?? null, inUse: currentlyInUse, waiting: now >= start }];
  }).sort((left, right) => Date.parse(left.trip.plannedStart) - Date.parse(right.trip.plannedStart) || left.trip.id.localeCompare(right.trip.id));
}
