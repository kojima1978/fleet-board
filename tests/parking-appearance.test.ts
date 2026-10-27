import assert from "node:assert/strict";
import { parkingSpotClass } from "../components/fleet-dashboard";
import type { ParkingSpot, Vehicle } from "../lib/types";

const spot: ParkingSpot = { id: "s1", code: "01", x: 0, y: 0, width: 5, height: 5, orientation: "vertical", enabled: true, version: 1, vehicle: null, role: "REGULAR", dedicatedVehicleId: null, dedicatedVehicleName: null, label: null };
const vehicle: Vehicle = { id: "v1", code: "C001", name: "テスト車", plateNumber: "テスト001", nfcUid: "", qrCode: "", hasEtc: false, hasNavigation: false, fuelLevel: null, color: "#2563eb", status: "AVAILABLE", parkingSpotId: spot.id, active: true, version: 1 };
assert.equal(parkingSpotClass(spot), "border-slate-300 bg-white/70");
assert.equal(parkingSpotClass({ ...spot, role: "TEMPORARY" }), "border-[3px] border-dashed border-slate-300/70 bg-slate-50/50");
assert.equal(parkingSpotClass({ ...spot, vehicle }), "border-blue-400 bg-blue-50", "駐車中の車両は変更しない");
assert.equal(parkingSpotClass({ ...spot, vehicle: { ...vehicle, status: "MAINTENANCE" } }), "border-slate-400 bg-slate-100");
assert.equal(parkingSpotClass({ ...spot, vehicle }, true), "border-[3px] border-dashed border-amber-400 bg-amber-50/70");
assert.doesNotMatch(parkingSpotClass(spot), /\bopacity-/, "文字や枠線まで透過させない");
console.log("Parking appearance tests passed: empty background only, unchanged borders/occupied/maintenance/off-site");
