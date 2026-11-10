import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmptyParkingSpotLabel, isWinterTireSeason, parkingSpotClass, VehicleMapIcon, visibleParkingSpots } from "../components/fleet-dashboard";
import { ParkingSpotNotice } from "../components/customer-spot-notice";
import { FrontSpotNotice } from "../components/front-spot-notice";
import { settingsSpotStateClass, settingsSpotStateLabel } from "../components/spot-role-settings";
import { blockingFrontSpots, freeRegularSpots, isCustomerSpot } from "../lib/parking-spots";
import type { ParkingSpot, Vehicle } from "../lib/types";
import { defaultFrontSpotCodes, parkingSpotGeometry } from "../prisma/parking-spot-seed";

const spot: ParkingSpot = { id: "s1", code: "01", x: 0, y: 0, width: 5, height: 5, orientation: "vertical", enabled: true, version: 1, vehicle: null, role: "REGULAR", vehicleClass: "ANY", dedicatedVehicleId: null, dedicatedVehicleName: null, label: null, frontSpotIds: [] };
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
const winterIcon = renderToStaticMarkup(createElement(VehicleMapIcon, { vehicle: { color: "#2563eb", hasBackMonitor: false, hasWinterTires: true, isKei: false }, className: "size-4" }));
assert.match(winterIcon, /スタッドレスタイヤ装着中/, "装着車の車アイコンへ雪マークの説明を付ける");
const normalIcon = renderToStaticMarkup(createElement(VehicleMapIcon, { vehicle: { color: "#2563eb", hasBackMonitor: false, hasWinterTires: false, isKei: false }, className: "size-4" }));
assert.doesNotMatch(normalIcon, /スタッドレスタイヤ装着中/, "未装着車には雪マークを付けない");
assert.doesNotMatch(normalIcon, /軽自動車|scale-80/, "普通車は縮めず軽マークも付けない");
assert.doesNotMatch(normalIcon, /バックモニター付/, "バックモニターなしの車にはカメラマークを付けない");
const backMonitorIcon = renderToStaticMarkup(createElement(VehicleMapIcon, { vehicle: { color: "#2563eb", hasBackMonitor: true, hasWinterTires: false, isKei: false }, className: "size-4" }));
assert.match(backMonitorIcon, /aria-label="バックモニター付"/, "バックモニター付の車アイコンへカメラマークを付ける");
const keiIcon = renderToStaticMarkup(createElement(VehicleMapIcon, { vehicle: { color: "#2563eb", hasBackMonitor: false, hasWinterTires: false, isKei: true }, className: "size-4" }));
assert.match(keiIcon, /scale-80/, "軽自動車の車アイコンを縮める");
assert.match(keiIcon, /aria-label="軽自動車"/, "軽自動車に軽マークを付ける");
const dedicatedEmpty = renderToStaticMarkup(createElement(EmptyParkingSpotLabel, { spot: { ...spot, role: "DEDICATED", dedicatedVehicleName: "サクラ" } }));
assert.match(dedicatedEmpty, />空き</, "専用区画も空いている状態を先に表示する");
assert.match(dedicatedEmpty, />サクラ専用</, "空き専用区画の用途を文字で表示する");
assert.doesNotMatch(dedicatedEmpty, /lucide-map-pin/, "意味の分かりにくいピンを空き区画に表示しない");
const classEmpty = renderToStaticMarkup(createElement(EmptyParkingSpotLabel, { spot: { ...spot, vehicleClass: "KEI" } }));
assert.doesNotMatch(classEmpty, />返却先</, "推奨車種がある空き区画は重複する返却先表示を省く");
assert.match(classEmpty, />軽用</, "推奨車種も同じ区画内に表示する");
const normalEmpty = renderToStaticMarkup(createElement(EmptyParkingSpotLabel, { spot }));
assert.match(normalEmpty, />返却先</, "推奨車種がない通常の空き区画は返却先と表示する");
const customerEmpty = renderToStaticMarkup(createElement(EmptyParkingSpotLabel, { spot: { ...spot, role: "CUSTOMER" } }));
assert.match(customerEmpty, />空き</, "お客様用区画も空き状態を先に表示する");
assert.match(customerEmpty, />お客様用</, "お客様用区画の用途を文字で表示する");
assert.deepEqual(visibleParkingSpots([{ id: "on", enabled: true }, { id: "off", enabled: false }]).map((item) => item.id), ["on"], "通常の配置図ではOFF区画を枠ごと表示しない");
const parkingLayout = readFileSync("public/parking-layout.svg", "utf8");
assert.doesNotMatch(parkingLayout, /id="Rectangle (?:[1-9]|1[0-9]|2[0-6])"|stroke-dasharray/, "背景SVGに区画の実線・点線を残さない");
assert.match(settingsSpotStateClass(false), /border-dashed/, "設定画面のOFF区画を破線にする");
assert.match(settingsSpotStateClass(false), /bg-slate-100/, "設定画面のOFF区画を落ち着いたグレーにする");
assert.equal(settingsSpotStateLabel(false), "非表示", "設定画面のOFF区画に非表示ラベルを出す");
assert.equal(settingsSpotStateLabel(true), null, "設定画面のON区画には非表示ラベルを出さない");
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
const notice = renderToStaticMarkup(createElement(ParkingSpotNotice, { spot: { ...spot, role: "CUSTOMER" }, spots: spotsForNotice, vehicle, onChooseOther: () => {} }));
assert.match(notice, /お客様用の区画です/);
assert.match(notice, /できるだけ通常の区画に止めてください/);
assert.match(notice, /空いている通常区画：03・07/);
assert.match(notice, /別の区画を選ぶ/);
const mismatchedNotice = renderToStaticMarkup(createElement(ParkingSpotNotice, { spot: { ...spot, vehicleClass: "KEI" }, spots: spotsForNotice, vehicle: { ...vehicle, isKei: false } }));
assert.match(mismatchedNotice, /軽自動車用の区画です/);
assert.match(mismatchedNotice, /選んだ車両は普通車です/);
const noOther = renderToStaticMarkup(createElement(ParkingSpotNotice, { spot: { ...spot, role: "CUSTOMER" }, spots: [spotsForNotice[0]], vehicle, onChooseOther: () => {} }));
assert.match(noOther, /いま空いている通常区画はありません/);
assert.doesNotMatch(noOther, /別の区画を選ぶ/, "選び直す先がなければボタンを出さない");
const frontSpots: ParkingSpot[] = [
  { ...spot, id: "f13", code: "13", vehicle: { ...vehicle, id: "v13", name: "アクア 2" } },
  { ...spot, id: "f14", code: "14", vehicle: { ...vehicle, id: "v14", name: "プロボックス" } },
  { ...spot, id: "f15", code: "15", vehicle: { ...vehicle, id: "v15", name: "タウンエース" }, frontSpotIds: ["f13", "f14"] },
  { ...spot, id: "f16", code: "16", frontSpotIds: ["f15"] },
];
assert.deepEqual(blockingFrontSpots(frontSpots[2], frontSpots).map((item) => item.code), ["13", "14"], "手前の区画のうち車がある区画を返す");
const withDisabledFront = frontSpots.map((spot) => ({ ...spot, enabled: spot.code !== "13" }));
assert.deepEqual(blockingFrontSpots(frontSpots[2], withDisabledFront).map((spot) => spot.code), ["14"], "オフの区画は手前の区画の判定に含めない");
assert.deepEqual(blockingFrontSpots({ ...frontSpots[2], frontSpotIds: [] }, frontSpots), [], "手前の区画を設定していなければ注意しない");
assert.deepEqual(blockingFrontSpots(frontSpots[3], frontSpots, "v15"), [], "動かす車自身は手前の車に数えない");
assert.deepEqual(blockingFrontSpots(undefined, frontSpots), [], "区画がなければ注意しない");
const outNotice = renderToStaticMarkup(createElement(FrontSpotNotice, { spot: frontSpots[2], spots: frontSpots, vehicleId: "v15", direction: "out" }));
assert.match(outNotice, /手前の区画13（アクア 2）・14（プロボックス）に車があります/);
assert.match(outNotice, /出庫するには、先に手前の車の移動が必要です。登録はこのまま続けられます。/);
const inNotice = renderToStaticMarkup(createElement(FrontSpotNotice, { spot: frontSpots[3], spots: frontSpots, vehicleId: "v1", direction: "in" }));
assert.match(inNotice, /手前の区画15（タウンエース）に車があります/);
assert.match(inNotice, /入庫するには/);
assert.equal(renderToStaticMarkup(createElement(FrontSpotNotice, { spot: frontSpots[0], spots: frontSpots, direction: "in" })), "", "手前に車がなければ何も出さない");
const geometryCodes = new Set<string>(parkingSpotGeometry.map((item) => item.code));
for (const [code, fronts] of Object.entries(defaultFrontSpotCodes)) {
  assert.ok(geometryCodes.has(code), `手前の区画の初期値に存在しない区画 ${code}`);
  assert.ok(fronts.length && fronts.every((front) => geometryCodes.has(front) && front !== code), `区画 ${code} の手前の区画の初期値`);
}
assert.deepEqual(defaultFrontSpotCodes["15"], ["13", "14"], "READMEの例と同じ");
for (const code of ["22", "23", "24", "26", "32", "08", "13", "17"]) assert.equal(defaultFrontSpotCodes[code], undefined, "道路に面する区画には手前の区画を入れない");
const migrationDefaults = Object.fromEntries([...readFileSync("prisma/migrations/20261109100000_default_front_spots/migration.sql", "utf8").matchAll(/\('(\d+)', ARRAY\[([^\]]*)\]\)/g)].map(([, code, list]) => [code, list.match(/\d+/g) ?? []]));
assert.deepEqual(migrationDefaults, Object.fromEntries(Object.entries(defaultFrontSpotCodes).map(([code, fronts]) => [code, [...fronts]])), "既存DB向けの移行と初期値の表をそろえる");
console.log("Parking appearance tests passed: empty background only, back monitor camera mark, unchanged borders/occupied/maintenance/off-site, customer spot notice, front spot notice, default front spots");
