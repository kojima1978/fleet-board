import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmptyParkingSpotLabel, parkingSpotClass, VehicleMapIcon, vehicleTileContent, visibleParkingSpots } from "../components/fleet-dashboard";
import { ParkingSpotNotice } from "../components/customer-spot-notice";
import { FrontSpotNotice } from "../components/front-spot-notice";
import { settingsSpotStateClass, settingsSpotStateLabel, settingsSpotVehicleClassLabel } from "../components/spot-role-settings";
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
const equippedIcon = renderToStaticMarkup(createElement(VehicleMapIcon, { vehicle: { color: "#2563eb", isKei: false }, className: "size-4" }));
assert.doesNotMatch(equippedIcon, /軽自動車|scale-80/, "普通車は縮めず軽マークも付けない");
// 装備は車の絵に印を重ねず、文字のタグで示す。区画内では4つの置き場所を固定し、ない装備の場所は空けておく。
// 縦向きは2行2列（上の行に ETC・ナビ）、横向きは上の帯に1行4列で並べる。
const equipmentSlots = (tile: string) => [...tile.matchAll(/<span (?:title="([^"]+)"|aria-hidden="true")[^>]*>(ETC|ナビ|バック|冬)<\/span>/g)].map((match) => match[1] ? match[2] : "");
for (const horizontal of [false, true]) {
  const fullTile = renderToStaticMarkup(vehicleTileContent({ ...vehicle, hasEtc: true, hasNavigation: true, hasBackMonitor: true, hasWinterTires: true }, horizontal));
  assert.match(fullTile, /aria-label="装備：ETC、ナビ、バックモニター、冬タイヤ"/, "区画内の装備タグに正式な名前をまとめて付ける");
  assert.deepEqual(equipmentSlots(fullTile), ["ETC", "ナビ", "バック", "冬"], "ETC・ナビ・バック・冬の順に並べ、大事なETC・ナビを先頭の行に置く");
  assert.match(fullTile, /title="バックモニター"[^>]*bg-emerald-100[^>]*>バック</, "バックモニターは緑の「バック」タグにする");
  assert.match(fullTile, /title="冬タイヤ"[^>]*>冬</, "スタッドレスタイヤは「冬」タグにする");
  if (horizontal) {
    assert.match(fullTile, /class="[^"]*grid-cols-\[repeat\(4,auto\)\][^"]* absolute right-0\.5 top-0\.5 [^"]*" aria-label="装備：/, "横向きの区画は装備タグを上の帯に1行4列で置き、車両名の幅を確保する");
    assert.match(fullTile, /\[\[data-move-mode\]_&amp;\]:invisible[^"]*" aria-label="装備：/, "位置変更モードでは右上の移動用のつまみと重ならないよう装備タグを隠す");
  } else assert.match(fullTile, /class="[^"]*grid-cols-\[auto_auto\][^"]*" aria-label="装備：/, "縦向きの区画は装備タグを2行2列で置く");
  const maintenanceTile = renderToStaticMarkup(vehicleTileContent({ ...vehicle, status: "MAINTENANCE", hasBackMonitor: true }, horizontal));
  assert.match(maintenanceTile, /整備中/, "整備中の車は区画内に整備中と出す");
  assert.doesNotMatch(maintenanceTile, /装備：/, "整備中の車は装備タグの代わりに整備中と出す");
  assert.doesNotMatch(fullTile, /lucide-camera|lucide-snowflake/, "車の絵にカメラや雪の印を重ねない");
  const plainTile = renderToStaticMarkup(vehicleTileContent(vehicle, horizontal));
  assert.doesNotMatch(plainTile, /装備：/, "装備のない車にはタグを出さない");
  const partialTile = renderToStaticMarkup(vehicleTileContent({ ...vehicle, hasNavigation: true, hasWinterTires: true }, horizontal));
  assert.match(partialTile, /aria-label="装備：ナビ、冬タイヤ"/, "読み上げにはある装備だけを伝える");
  assert.deepEqual(equipmentSlots(partialTile), ["", "ナビ", "", "冬"], "ない装備の場所は空けて、ある装備の位置を動かさない");
}
// 縦向きの区画は幅が狭いので、長い車両名は文字を小さくして1行に収める。
const verticalName = (name: string) => renderToStaticMarkup(vehicleTileContent({ ...vehicle, name }, false)).match(/<b class="([^"]*)"/)?.[1] ?? "";
assert.match(verticalName("プリウス"), /@4xl:text-\[13px\]/, "4文字までの車両名は大きいまま表示する");
assert.match(verticalName("アクア 1"), /@4xl:text-\[13px\]/, "半角の文字は全角の約半分の幅として数える");
assert.match(verticalName("ヴォクシー"), /@4xl:text-\[10px\]/, "5文字の車両名は少し小さくする");
assert.match(verticalName("確認用テスト車"), /@4xl:text-\[8px\]/, "7文字の車両名はさらに小さくする");
assert.match(verticalName("確認用テスト車"), /\btruncate\b/, "縦向きの車両名は折り返さず1行に収める");
assert.doesNotMatch(renderToStaticMarkup(vehicleTileContent({ ...vehicle, name: "確認用テスト車" }, true)).match(/<b class="([^"]*)"/)?.[1] ?? "", /truncate|text-\[8px\]/, "横向きの区画の車両名は小さくしない");
const keiIcon = renderToStaticMarkup(createElement(VehicleMapIcon, { vehicle: { color: "#2563eb", isKei: true }, className: "size-4" }));
assert.match(keiIcon, /scale-80/, "軽自動車の車アイコンを縮める");
assert.doesNotMatch(keiIcon, />軽</, "軽の札は車アイコンではなく車両番号の横に付ける");
// 区画内は車両番号の濃い札、車両名、ナンバーの順に並べ、車両番号の横に「軽」（黄）または「普」（白）の札を付ける。
for (const horizontal of [false, true]) {
  const keiTile = renderToStaticMarkup(vehicleTileContent({ ...vehicle, isKei: true, plateNumber: "品川 500 あ 12-34" }, horizontal));
  assert.match(keiTile, /bg-slate-800[^"]*text-white[^"]*">C001<\/span><span aria-label="軽自動車"[^>]*>軽<\/span>/, "車両番号の濃い札の横に軽の札を付ける");
  assert.ok(keiTile.indexOf(">C001<") < keiTile.indexOf(">テスト車<") && keiTile.indexOf(">テスト車<") < keiTile.indexOf("12-34"), "車両番号・車両名・ナンバーの順に並べる");
  assert.match(keiTile, /<small class="[^"]*tabular-nums/, "ナンバーは数字の幅をそろえる");
  const standardTile = renderToStaticMarkup(vehicleTileContent(vehicle, horizontal));
  assert.doesNotMatch(standardTile, /軽自動車/, "普通車には軽の札を付けない");
  assert.match(standardTile, />C001<\/span><span aria-label="普通車"[^>]*bg-white[^>]*>普<\/span>/, "普通車は車両番号の横に白い「普」の札を付ける");
  assert.match(keiTile, /<span class="grid w-fit grid-cols-\[auto_auto\][^"]*"><span class="[^"]*bg-slate-800/, "車両番号と普・軽の札は2列に固定して並べる");
  if (!horizontal) assert.match(keiTile, /<\/svg><\/span><span class="grid w-fit/, "縦向きの区画は車の絵を車両番号の段に入れず、最上段に1つだけ置く");
}
// 縦向きの区画は上下中央に寄せず上から順に置き、装備タグは下端にそろえる（装備や車両名の長さで高さがずれない）。
{
  const verticalTile = renderToStaticMarkup(vehicleTileContent({ ...vehicle, hasEtc: true }, false));
  assert.match(verticalTile, /^<span class="absolute inset-0 flex [^"]*flex-col[^"]*@4xl:pt-4"/, "縦向きの区画は区画の上から決まった位置に置く");
  assert.match(verticalTile, /<span class="mt-auto"><span class="[^"]*grid-cols-\[auto_auto\][^"]*" aria-label="装備：/, "装備タグは区画の下端にそろえる");
  for (const name of ["プリウス", "ヴォクシー", "確認用テスト車"]) assert.match(renderToStaticMarkup(vehicleTileContent({ ...vehicle, name }, false)).match(/<b class="([^"]*)"/)?.[1] ?? "", /@4xl:leading-\[13px\]/, "車両名の行の高さは名前の長さによらず一定にする");
}
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
assert.match(parkingLayout, /d="M271 11L521\.305 11L521\.305 130L647\.6 130L647\.6 208\.134L758\.4 208\.134L895 288\.796" stroke="black" stroke-width="0\.8"/, "上側の既存線を残し、社屋境界線をサクラ区画の上・右から斜め線へつなぐ");
assert.match(parkingLayout, /id="Building label" transform="translate\(0 -32\)"/, "社屋の文字を上側へ移動する");
assert.match(parkingLayout, /id="Entrance label" x="553" y="52"[\s\S]*?writing-mode="vertical-rl" text-orientation="upright" dominant-baseline="central" letter-spacing="6">入口<\/text>/, "入口を1つの縦書き文字列として同じ中心軸に表示する");
assert.match(settingsSpotStateClass(false), /border-dashed/, "設定画面のOFF区画を破線にする");
assert.match(settingsSpotStateClass(false), /bg-slate-100/, "設定画面のOFF区画を落ち着いたグレーにする");
assert.equal(settingsSpotStateLabel(false), "非表示", "設定画面のOFF区画に非表示ラベルを出す");
assert.equal(settingsSpotStateLabel(true), null, "設定画面のON区画には非表示ラベルを出さない");
assert.equal(settingsSpotVehicleClassLabel("KEI"), "軽", "設定画面の配置図に軽自動車用の略号を表示する");
assert.equal(settingsSpotVehicleClassLabel("STANDARD"), "普", "設定画面の配置図に普通車用の略号を表示する");
assert.equal(settingsSpotVehicleClassLabel("ANY"), null, "推奨車種がない区画には車種ラベルを出さない");
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
console.log("Parking appearance tests passed: empty background only, equipment tags in tiles, unchanged borders/occupied/maintenance/off-site, customer spot notice, front spot notice, default front spots");
