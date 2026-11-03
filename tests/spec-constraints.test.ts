import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 仕様書「10. 制約値の一覧」の値と、コードに書かれた値が食い違っていないかを確かめる。
// コードの値を変えたら、仕様書の表とこの対応表の両方を直す。
type Constraint = { item: string; value: string; code: [file: string, snippet: string][] };

const constraints: Constraint[] = [
  { item: "利用・予約の長さ", value: "15分〜7日（10,080分）", code: [["app/api/dashboard/route.ts", "minutes: z.number().int().min(15).max(10_080)"]] },
  { item: "予約の自動取消", value: "開始予定から30分", code: [["lib/reservations.ts", "RESERVATION_GRACE_MINUTES = 30"]] },
  { item: "予約の目印を出す時期", value: "開始の30分前", code: [["lib/parking-reservations.ts", "PARKING_RESERVATION_NOTICE_MINUTES = 30"]] },
  { item: "1日利用の時間帯", value: "6:00〜22:00、7日先まで", code: [
    ["lib/all-day-reservation.ts", "T06:00:00+09:00"],
    ["lib/all-day-reservation.ts", "7 * DAY"],
    ["components/fleet-dashboard.tsx", "allDayBeginning.getTime() + 16 * 60 * 60_000"],
  ] },
  { item: "延長の選択肢", value: "30分・1時間・2時間・3時間・終日", code: [
    ["components/fleet-dashboard.tsx", "EXTEND_MINUTES = [30, 60, 120, 180]"],
    ["components/fleet-dashboard.tsx", "{ key: \"day\", label: \"終日\""],
  ] },
  { item: "返却の取り消し", value: "画面30秒、サーバー2分", code: [
    ["components/fleet-dashboard.tsx", "UNDO_RETURN_SECONDS = 30"],
    ["app/api/dashboard/route.ts", "trip.actualEnd.getTime() > 2 * 60_000"],
  ] },
  { item: "返却時ポップの自動終了", value: "7秒", code: [["components/fleet-dashboard.tsx", "FUEL_NOTICE_AUTO_CLOSE_SECONDS = 7"]] },
  { item: "給油時のお礼の自動終了", value: "約4秒", code: [["components/fleet-dashboard.tsx", "FUEL_THANK_YOU_AUTO_CLOSE_MS = 4_000"]] },
  { item: "NFC読取の待ち時間", value: "15秒", code: [["components/fleet-dashboard.tsx", "NFC_SCAN_TIMEOUT_MS = 15_000"]] },
  { item: "共用端末のリセット", value: "10分（30秒前に予告）", code: [
    ["lib/use-kiosk-idle.ts", "DEFAULT_IDLE_MS = 10 * 60_000"],
    ["lib/use-kiosk-idle.ts", "DEFAULT_WARNING_MS = 30_000"],
  ] },
  { item: "利用者の自動解除", value: "1・3・5分（初期3分）", code: [
    ["lib/device-mode.ts", "USER_TIMEOUT_CHOICES = [1, 3, 5]"],
    ["lib/device-mode.ts", "String(minutes) === value) ?? 3"],
  ] },
  { item: "画面の自動更新", value: "駐車場・タイムライン5秒、設定30秒", code: [["components/fleet-dashboard.tsx", "view === \"parking\" || view === \"timeline\" ? 5_000 : 30_000"]] },
  { item: "社員番号・車両番号", value: "英字1文字＋数字3桁", code: [["lib/record-codes.ts", "/^[A-Z]\\d{3}$/"]] },
  { item: "氏名・車両名", value: "50文字", code: [["app/api/dashboard/route.ts", "name: z.string().trim().min(1).max(50)"]] },
  { item: "ナンバー", value: "30文字", code: [["app/api/dashboard/route.ts", "plateNumber: z.string().trim().min(1).max(30)"]] },
  { item: "ガソリンカード", value: "40文字", code: [["app/api/dashboard/route.ts", "fuelCardSchema = z.string().trim().max(40)"]] },
  { item: "部署名", value: "50文字", code: [["app/api/dashboard/route.ts", "departmentNameSchema = z.string().trim().min(1).max(50)"]] },
  { item: "区画番号", value: "12文字", code: [["app/api/dashboard/route.ts", ".max(12, \"区画番号は12文字以内"]] },
  { item: "区画の表示名", value: "10文字", code: [["lib/parking-spots.ts", "SPOT_LABEL_MAX_LENGTH = 10"]] },
  { item: "手前の区画", value: "1区画につき20件", code: [["app/api/dashboard/route.ts", "FRONT_SPOT_MAX = 20"]] },
  { item: "JSON取込", value: "1回500件", code: [
    ["app/api/dashboard/route.ts", "items: z.array(employeeImportItemSchema).min(1).max(500)"],
    ["app/api/dashboard/route.ts", "items: z.array(vehicleImportItemSchema).min(1).max(500)"],
  ] },
  { item: "QRメールの一括送信", value: "100人", code: [["app/api/qr/email/route.ts", "employeeIds: z.array(z.string().min(1)).min(1).max(100)"]] },
  { item: "ガソリン案内の文面", value: "1〜500文字", code: [["lib/fuel-return-notice.ts", "z.string().trim().min(1).max(500)"]] },
  { item: "給油時のお礼・駐車案内の文面", value: "1〜300文字", code: [
    ["lib/fuel-thank-you.ts", "message: z.string().trim().min(1).max(300)"],
    ["lib/parking-guidance.ts", "message: z.string().trim().min(1).max(300)"],
  ] },
  { item: "案内の音声", value: "MP3・WAV、2MB", code: [
    ["lib/fuel-return-notice.ts", "FUEL_NOTICE_AUDIO_MAX_BYTES = 2 * 1024 * 1024"],
    ["lib/parking-guidance.ts", "PARKING_GUIDANCE_AUDIO_MAX_BYTES = 2 * 1024 * 1024"],
    ["lib/json-backup.ts", "audioMime: z.enum([\"audio/mpeg\", \"audio/wav\"])"],
  ] },
  { item: "開始時刻の訂正理由", value: "200文字", code: [["app/api/dashboard/route.ts", "reason: z.string().trim().min(1).max(200)"]] },
  { item: "整備の備考", value: "200文字", code: [["lib/maintenance.ts", "MAINTENANCE_NOTE_MAX = 200"]] },
  { item: "整備予定の登録範囲", value: "366日先まで", code: [["lib/maintenance.ts", "MAINTENANCE_SCHEDULE_DAYS_AHEAD = 366"]] },
  { item: "整備の最長期間", value: "90日", code: [["lib/maintenance.ts", "MAINTENANCE_MAX_DAYS = 90"]] },
  { item: "駐車場画面の整備予定", value: "2日前から、最大3件", code: [
    ["lib/maintenance.ts", "UPCOMING_MAINTENANCE_DAYS_BEFORE = 2"],
    ["lib/maintenance.ts", "UPCOMING_MAINTENANCE_LIMIT = 3"],
  ] },
  { item: "CSV書き出し", value: "10,000件", code: [
    ["app/api/operations/route.ts", "take: 10_000"],
    ["app/api/trips/history/route.ts", "take: 10_000"],
  ] },
  { item: "JSON復元のファイル", value: "50MB", code: [["lib/json-backup.ts", "JSON_BACKUP_MAX_BYTES = 50 * 1024 * 1024"]] },
];
// アプリのコードではなく、db-backup コンテナーの設定で決まる行。
const outsideApp = new Set(["自動バックアップ"]);

const spec = readFileSync("docs/仕様書.md", "utf8");
const section = spec.split("## 10. 制約値の一覧")[1]?.split(/\n## /)[0] ?? "";
const rows = section.split("\n")
  .filter((line) => line.startsWith("| ") && !line.startsWith("| 項目") && !line.startsWith("| ---"))
  .map((line) => line.split("|").map((cell) => cell.trim()))
  .map(([, item, value]) => ({ item, value }));
assert.ok(rows.length > 0, "仕様書に「10. 制約値の一覧」の表が見つかりません");

const files = new Map<string, string>();
const read = (file: string) => files.get(file) ?? files.set(file, readFileSync(file, "utf8")).get(file)!;

for (const row of rows) {
  if (outsideApp.has(row.item)) continue;
  const constraint = constraints.find((entry) => entry.item === row.item);
  assert.ok(constraint, `仕様書の「${row.item}」が対応表にありません。tests/spec-constraints.test.ts に、コードの値と組にして足してください`);
  assert.equal(row.value, constraint.value, `仕様書の「${row.item}」の値が対応表と違います。コードの値を確かめて、仕様書か対応表を直してください`);
  for (const [file, snippet] of constraint.code) {
    assert.ok(read(file).includes(snippet), `「${row.item}」のコードが変わっています（${file} に ${snippet} がありません）。仕様書の値と対応表を直してください`);
  }
}
const specItems = new Set(rows.map((row) => row.item));
const unused = constraints.filter((entry) => !specItems.has(entry.item)).map((entry) => entry.item);
assert.deepEqual(unused, [], `仕様書にない項目が対応表に残っています：${unused.join("、")}`);
console.log(`Spec constraints passed: ${constraints.length} rows match the code`);
