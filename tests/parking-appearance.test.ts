import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { isWinterTireSeason, parkingSpotClass, VehicleMapIcon } from "../components/fleet-dashboard";
import { CustomerSpotNotice } from "../components/customer-spot-notice";
import { freeRegularSpots, isCustomerSpot } from "../lib/parking-spots";
import type { ParkingSpot, Vehicle } from "../lib/types";

const spot: ParkingSpot = { id: "s1", code: "01", x: 0, y: 0, width: 5, height: 5, orientation: "vertical", enabled: true, version: 1, vehicle: null, role: "REGULAR", dedicatedVehicleId: null, dedicatedVehicleName: null, label: null };
const vehicle: Vehicle = { id: "v1", code: "C001", name: "テスト車", plateNumber: "テスト001", nfcUid: "", qrCode: "", hasEtc: false, hasNavigation: false, hasWinterTires: false, hasBackMonitor: false, isKei: false, fuelCard: "", fuelLevel: null, color: "#2563eb", status: "AVAILABLE", parkingSpotId: spot.id, active: true, version: 1 };
assert.equal(parkingSpotClass(spot), "border-slate-300 bg-white/70");
assert.equal(parkingSpotClass({ ...spot, role: "TEMPORARY" }), "border-[3px] border-dashed border-slate-300/70 bg-slate-50/50");
assert.equal(parkingSpotClass({ ...spot, vehicle }), "border-blue-400 bg-blue-50", "駐車中の車両は変更しない");
assert.equal(parkingSpotClass({ ...spot, vehicle: { ...vehicle, status: "MAINTENANCE" } }), "border-slate-400 bg-slate-100");
assert.equal(parkingSpotClass({ ...spot, vehicle }, true), "border-[3px] border-dashed border-amber-400 bg-amber-50/70");
assert.doesNotMatch(parkingSpotClass(spot), /\bopacity-/, "文字や枠線まで透過させない");
assert.equal(isWinterTireSeason(new Date("2026-10-31T14:59:59Z")), false, "東京時間の10月中は冬タイヤ凡例を出さない");
assert.equal(isWinterTireSeason(new Date("2026-10-31T15:00:00Z")), true, "東京時間の11月から冬タイヤ凡例を出す");
assert.equal(isWinterTireSeason(new Date("2027-04-30T14:59:59Z")), true, "東京時間の4月末までは冬タイヤ凡例を出す");
assert.equal(isWinterTireSeason(new Date("2027-04-30T15:00:00Z")), false, "東京時間の5月から冬タイヤ凡例を出さない");
const winterIcon = renderToStaticMarkup(createElement(VehicleMapIcon, { vehicle: { color: "#2563eb", hasWinterTires: true, isKei: false }, className: "size-4" }));
assert.match(winterIcon, /スタッドレスタイヤ装着中/, "装着車の車アイコンへ雪マークの説明を付ける");
const normalIcon = renderToStaticMarkup(createElement(VehicleMapIcon, { vehicle: { color: "#2563eb", hasWinterTires: false, isKei: false }, className: "size-4" }));
assert.doesNotMatch(normalIcon, /スタッドレスタイヤ装着中/, "未装着車には雪マークを付けない");
assert.doesNotMatch(normalIcon, /軽自動車|scale-80/, "普通車は縮めず軽マークも付けない");
const keiIcon = renderToStaticMarkup(createElement(VehicleMapIcon, { vehicle: { color: "#2563eb", hasWinterTires: false, isKei: true }, className: "size-4" }));
assert.match(keiIcon, /scale-80/, "軽自動車の車アイコンを縮める");
assert.match(keiIcon, /aria-label="軽自動車"/, "軽自動車に軽マークを付ける");
const spotsForNotice: ParkingSpot[] = [
  { ...spot, id: "c1", code: "01", role: "CUSTOMER" },
  { ...spot, id: "r1", code: "03" },
  { ...spot, id: "r2", code: "04", vehicle },
  { ...spot, id: "r3", code: "05", enabled: false },
  { ...spot, id: "t1", code: "06", role: "TEMPORARY" },
  { ...spot, id: "d1", code: "07", role: "DEDICATED", dedicatedVehicleId: "v1" },
  { ...spot, id: "d2", code: "08", role: "DEDICATED", dedicatedVehicleId: "v2" },
];
assert.equal(isCustomerSpot({ role: "CUSTOMER" }), true);
assert.equal(isCustomerSpot({ role: "REGULAR" }), false);
assert.deepEqual(freeRegularSpots(spotsForNotice, vehicle).map((item) => item.code), ["03", "07"], "空いている通常区画とその車の専用区画だけを案内する");
assert.deepEqual(freeRegularSpots(spotsForNotice, null).map((item) => item.code), ["03"], "車が決まっていなければ通常区画だけ");
const notice = renderToStaticMarkup(createElement(CustomerSpotNotice, { spots: spotsForNotice, vehicle, onChooseOther: () => {} }));
assert.match(notice, /お客様用の区画です/);
assert.match(notice, /できるだけ通常の区画に止めてください/);
assert.match(notice, /空いている通常区画：03・07/);
assert.match(notice, /別の区画を選ぶ/);
const noOther = renderToStaticMarkup(createElement(CustomerSpotNotice, { spots: [spotsForNotice[0]], vehicle, onChooseOther: () => {} }));
assert.match(noOther, /いま空いている通常区画はありません/);
assert.doesNotMatch(noOther, /別の区画を選ぶ/, "選び直す先がなければボタンを出さない");
console.log("Parking appearance tests passed: empty background only, unchanged borders/occupied/maintenance/off-site, customer spot notice");
