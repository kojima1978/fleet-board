import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { findEmployees } from "../components/employee-picker";
import { MaintenanceReturnDialog, OffSiteMaintenancePopover, StartDialog } from "../components/fleet-dashboard";
import { isKioskDevice, type DeviceMode } from "../lib/device-mode";
import type { NfcBridgeStatus } from "../lib/use-nfc-bridge";
import type { Employee, ParkingSpot, Vehicle, VehicleMaintenance, Trip } from "../lib/types";

const employee: Employee = { id: "e1", code: "E001", name: "手動選択テスト", department: "総務", email: "", nfcUid: "", qrCode: "", active: true, version: 1 };
const vehicle: Vehicle = { id: "v1", code: "C001", name: "出庫テスト車", plateNumber: "テスト001", nfcUid: "", qrCode: "", hasEtc: false, hasNavigation: false, hasWinterTires: false, hasBackMonitor: false, isKei: false, fuelCard: "", fuelLevel: null, color: "#2563eb", status: "AVAILABLE", parkingSpotId: "s1", active: true, version: 1 };
const noop = () => {};
function render(mode: DeviceMode, status: NfcBridgeStatus, selected: Employee | null = null) {
  return renderToStaticMarkup(<StartDialog kiosk={isKioskDevice(mode, status)} employees={[employee]} vehicles={[vehicle]} trips={[]} initialEmployee={selected} initialVehicleId={vehicle.id} submitting={false} onClose={noop} onSubmit={noop} />);
}

for (const status of ["idle", "connecting", "offline", "no-reader", "ready"] as const) {
  const html = render("personal", status);
  assert.match(html, /社員番号または氏名を入力/);
  assert.match(html, /先に利用者を選んでください/);
  assert.doesNotMatch(html, /社員証をかざす|社員QRを読み取|先に社員証|NFC UIDを手入力|読取を再試行/);
}
for (const status of ["idle", "connecting", "offline"] as const) {
  const html = render("auto", status);
  assert.match(html, /先に利用者を選んでください/, "自動判定で各自PCの場合も手動案内");
  assert.doesNotMatch(html, /社員証をかざす|社員QRを読み取|先に社員証/);
}
for (const status of ["offline", "no-reader", "ready"] as const) {
  assert.match(render("kiosk", status), /社員証をかざすか、社員QRを読み取ってください/);
}
assert.match(render("auto", "ready"), /社員証をかざすか、社員QRを読み取ってください/);
const selected = render("personal", "offline", employee);
assert.match(selected, /手動選択テスト/);
assert.match(selected, /選び直す/);
assert.match(selected, /この内容で利用開始/);
assert.doesNotMatch(selected, /社員証をかざす|先に社員証/);
assert.match(selected, /今すぐ利用/);
assert.doesNotMatch(selected, /予約の日時を指定|予約種別|>時刻指定<|>今すぐ</);
const lowFuelVehicle = { ...vehicle, fuelLevel: 2 };
const lowFuelStart = renderToStaticMarkup(<StartDialog kiosk={false} employees={[employee]} vehicles={[lowFuelVehicle]} trips={[]} initialEmployee={employee} initialVehicleId={lowFuelVehicle.id} submitting={false} onClose={noop} onSubmit={noop} />);
assert.match(lowFuelStart, /ガソリン残量が1\/2以下です/);
assert.match(lowFuelStart, /可能であれば、利用中の給油をお願いします。/);
assert.equal(lowFuelStart.match(/ガソリン残量が1\/2以下です/g)?.length, 1, "利用開始の給油案内は確定ボタン付近に1回だけ表示する");
assert.match(lowFuelStart, /fuel-reminder-attention/, "詳細入力画面を開いた時点で給油案内を短く強調する");
const now = Date.now();
const reservation: Trip = { id: "r1", employeeId: employee.id, vehicleId: vehicle.id, plannedStart: new Date(now - 60_000).toISOString(), plannedEnd: new Date(now + 3_600_000).toISOString(), actualStart: null, actualEnd: null, status: "RESERVED", purpose: null, returnSpotCode: null, returnFuelLevel: null, version: 1, employee, vehicle };
const reserve = renderToStaticMarkup(<StartDialog intent="scheduled" kiosk={false} employees={[employee]} vehicles={[vehicle]} trips={[reservation]} initialEmployee={employee} initialVehicleId={vehicle.id} submitting={false} onClose={noop} onSubmit={noop} />);
assert.match(reserve, /車両を予約/);
assert.match(reserve, /この内容で予約/);
assert.doesNotMatch(reserve, /予約した車両を利用開始|この内容で利用開始|>時刻指定<|>今すぐ</, "予約入口で現在の予約を利用開始しない");
const lowFuelReserve = renderToStaticMarkup(<StartDialog intent="scheduled" kiosk={false} employees={[employee]} vehicles={[lowFuelVehicle]} trips={[]} initialEmployee={employee} initialVehicleId={lowFuelVehicle.id} submitting={false} onClose={noop} onSubmit={noop} />);
assert.doesNotMatch(lowFuelReserve, /ガソリン残量が1\/2以下です/, "将来の予約時には現在の残量で給油案内を出さない");
const baseSpot: ParkingSpot = { id: "s1", code: "15", x: 0, y: 0, width: 5, height: 5, orientation: "vertical", enabled: true, version: 1, vehicle, role: "REGULAR", dedicatedVehicleId: null, dedicatedVehicleName: null, label: null, frontSpotIds: ["s2"] };
const blockedSpots: ParkingSpot[] = [baseSpot, { ...baseSpot, id: "s2", code: "14", vehicle: { ...vehicle, id: "v2", name: "プロボックス" }, frontSpotIds: [] }];
const blockedStart = renderToStaticMarkup(<StartDialog kiosk={false} employees={[employee]} vehicles={[vehicle]} trips={[]} spots={blockedSpots} initialEmployee={employee} initialVehicleId={vehicle.id} submitting={false} onClose={noop} onSubmit={noop} />);
assert.match(blockedStart, /手前の区画14（プロボックス）に車があります/, "今すぐ利用で手前の車を知らせる");
assert.match(blockedStart, /この内容で利用開始/, "注意だけで利用開始はできる");
const blockedReserve = renderToStaticMarkup(<StartDialog intent="scheduled" kiosk={false} employees={[employee]} vehicles={[vehicle]} trips={[]} spots={blockedSpots} initialEmployee={employee} initialVehicleId={vehicle.id} submitting={false} onClose={noop} onSubmit={noop} />);
assert.doesNotMatch(blockedReserve, /手前の区画/, "将来の予約では今の駐車状況で注意しない");
const offSiteVehicle: Vehicle = { ...vehicle, id: "v3", code: "C009", name: "シエンタ", status: "MAINTENANCE", parkingSpotId: null, fuelLevel: 2 };
const emptySpot: ParkingSpot = { ...baseSpot, id: "s3", code: "11", vehicle: null, frontSpotIds: ["s2"] };
const maintenanceReturn = renderToStaticMarkup(<MaintenanceReturnDialog vehicle={offSiteVehicle} spot={emptySpot} spots={[...blockedSpots, emptySpot]} mutate={async () => true} currentEmployeeId={null} onChangeSpot={noop} onClose={noop} />);
assert.match(maintenanceReturn, /シエンタを返却/, "利用中の返却と同じ見出し");
assert.match(maintenanceReturn, /C009 ・ 車検・修理で外出/, "車検から戻る車とわかる");
assert.match(maintenanceReturn, /区画 11/, "選んだ返却先を出す");
assert.match(maintenanceReturn, />変更</, "返却先を選び直せる");
assert.match(maintenanceReturn, /ガソリン残量/, "ガソリン残量を確かめる");
assert.match(maintenanceReturn, /手前の区画14（プロボックス）に車があります/, "手前の車を知らせる");
assert.match(maintenanceReturn, /区画 11へ返却する/, "注意だけで返却できる");
assert.doesNotMatch(maintenanceReturn, /延長/, "延長は状況の画面に残す");
const takenReturn = renderToStaticMarkup(<MaintenanceReturnDialog vehicle={offSiteVehicle} spot={{ ...emptySpot, vehicle }} spots={blockedSpots} mutate={async () => true} currentEmployeeId={null} onChangeSpot={noop} onClose={noop} />);
assert.match(takenReturn, /未選択/, "ほかの車が停まった区画には返却しない");
assert.match(takenReturn, /返却先を選択/);
const offSite: VehicleMaintenance = { id: "m1", vehicleId: offSiteVehicle.id, kind: "OFF_SITE", status: "ACTIVE", note: "○○整備工場", plannedStart: new Date(now - 86_400_000).toISOString(), plannedEnd: new Date(now + 86_400_000).toISOString(), actualStart: new Date(now - 86_400_000).toISOString(), actualEnd: null, returnSpotCode: null, version: 1 };
const offSitePopover = renderToStaticMarkup(<OffSiteMaintenancePopover maintenance={offSite} vehicle={offSiteVehicle} reservations={[]} mutate={async () => true} onReturn={noop} onClose={noop} />);
assert.match(offSitePopover, /シエンタ/);
assert.match(offSitePopover, /車検で外出/, "利用中の札の場所に車検で外出を出す");
assert.match(offSitePopover, /○○整備工場/, "備考を出す");
assert.match(offSitePopover, />返却する</, "利用中と同じ返却ボタン");
assert.match(offSitePopover, />半日<.*>1日<.*>2日</, "延長は半日・1日・2日");
assert.match(offSitePopover, />延長</, "戻り予定前は戻り予定から延ばす");
assert.match(offSitePopover, /延長する/);
assert.doesNotMatch(offSitePopover, /日時指定|備考を直す/, "細かい入力は設定画面で行う");
assert.doesNotMatch(offSitePopover, /予定を超過/);
const overduePopover = renderToStaticMarkup(<OffSiteMaintenancePopover maintenance={{ ...offSite, plannedEnd: new Date(now - 60_000).toISOString() }} vehicle={offSiteVehicle} reservations={[]} mutate={async () => true} onReturn={noop} onClose={noop} />);
assert.match(overduePopover, /予定を超過/);
assert.match(overduePopover, />今から</, "戻り予定を過ぎたら今から延ばす");
assert.match(renderToStaticMarkup(<OffSiteMaintenancePopover maintenance={{ ...offSite, plannedEnd: null }} vehicle={offSiteVehicle} reservations={[]} mutate={async () => true} onReturn={noop} onClose={noop} />), /未定.*今から/, "戻り予定が未定なら今から延ばす");
const nextReservation: Trip = { ...reservation, id: "r2", vehicleId: offSiteVehicle.id, plannedStart: new Date(now + 86_400_000 + 13 * 3_600_000).toISOString(), plannedEnd: new Date(now + 3 * 86_400_000).toISOString() };
const blockedPopover = renderToStaticMarkup(<OffSiteMaintenancePopover maintenance={offSite} vehicle={offSiteVehicle} reservations={[nextReservation]} mutate={async () => true} onReturn={noop} onClose={noop} />);
assert.equal(blockedPopover.match(/次の予約と重なるため選べません/g)?.length, 2, "次の予約と重なる1日・2日は選べない");
console.log("Departure guidance tests passed: personal/auto-personal manual selection, selected user reuse and kiosk scanner guidance, maintenance return dialog, off-site popover");

const manyEmployees = Array.from({length: 150}, (_, index) => ({ ...employee, id: `e${index + 1}`, code: `E${String(index + 1).padStart(3, "0")}`, name: `社員${index + 1}` }));
assert.equal(findEmployees(manyEmployees, "１５０", true)[0]?.code, "E150", "100人を超える候補も全角番号から検索できる");
assert.equal(findEmployees(manyEmployees, "001")[0]?.code, "E001");
assert.equal(findEmployees(manyEmployees, "ｅ００１")[0]?.code, "E001");
assert.equal(findEmployees([employee], "手動 選択 テスト")[0]?.id, employee.id);
assert.equal(findEmployees([{...employee, active: false}], "001").length, 0);
assert.equal(findEmployees(manyEmployees, "999", true).length, 0);
console.log("Employee search passed: 150 people, full-width numbers/codes, names, inactive filtering and empty matches");
