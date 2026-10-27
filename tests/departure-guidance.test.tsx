import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { StartDialog } from "../components/fleet-dashboard";
import { isKioskDevice, type DeviceMode } from "../lib/device-mode";
import type { NfcBridgeStatus } from "../lib/use-nfc-bridge";
import type { Employee, Vehicle } from "../lib/types";

const employee: Employee = { id: "e1", code: "E001", name: "手動選択テスト", department: "総務", email: "", nfcUid: "", qrCode: "", active: true, version: 1 };
const vehicle: Vehicle = { id: "v1", code: "C001", name: "出庫テスト車", plateNumber: "テスト001", nfcUid: "", qrCode: "", hasEtc: false, hasNavigation: false, fuelLevel: null, color: "#2563eb", status: "AVAILABLE", parkingSpotId: "s1", active: true, version: 1 };
const noop = () => {};
function render(mode: DeviceMode, status: NfcBridgeStatus, selected: Employee | null = null) {
  return renderToStaticMarkup(<StartDialog kiosk={isKioskDevice(mode, status)} employees={[employee]} vehicles={[vehicle]} trips={[]} initialEmployee={selected} initialVehicleId={vehicle.id} submitting={false} onClose={noop} onSubmit={noop} />);
}

for (const status of ["idle", "connecting", "offline", "no-reader", "ready"] as const) {
  const html = render("personal", status);
  assert.match(html, /社員を選択してください/);
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
console.log("Departure guidance tests passed: personal/auto-personal manual selection, selected user reuse and kiosk scanner guidance");
