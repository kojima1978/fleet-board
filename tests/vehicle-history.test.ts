import assert from "node:assert/strict";
import { formatHistoryDateTime, formatTripDuration, tripMinutes, vehicleHistoryCsv, vehicleHistoryPeriod, vehicleHistoryQuery } from "../lib/vehicle-history";

const now = new Date("2026-10-28T03:00:00Z");
const query = (value: string) => vehicleHistoryQuery(new URLSearchParams(value), now);
const range = query("vehicleId=v1&from=2026-10-27T23:00&to=2026-10-28T01:00&q=山田");
assert.equal(range.where.vehicleId, "v1");
assert.deepEqual(range.where.actualStart, { not: null, lte: new Date("2026-10-27T16:00:00Z") });
assert.deepEqual(range.where.OR, [{ actualEnd: { gt: new Date("2026-10-27T14:00:00Z") } }, { status: "IN_USE", actualEnd: null }]);
assert.deepEqual(query("").where.status, { in: ["IN_USE", "COMPLETED"] });
assert.deepEqual(query("from=2026-10-29T10:00").where.OR, [{ actualEnd: { gt: new Date("2026-10-29T01:00:00Z") } }]);
assert.deepEqual(query("to=2026-10-29T10:00").where.actualStart, { not: null, lte: now });
assert.doesNotThrow(() => query("from=2026-10-28T10:00&to=2026-10-28T10:00"));
for (const value of ["from=2026-02-30T10:00", "from=2026-10-28T25:00", "from=2026-10-28", "from=bad", "from=2026-10-29T10:00&to=2026-10-28T10:00"]) assert.throws(() => query(value));
assert.equal(query("page=-1").page, 1);
assert.equal(query("page=99999999").page, 10_000);
assert.deepEqual(vehicleHistoryPeriod(1, new Date("2026-03-31T16:20:00Z")), { from: "2026-03-01T01:20", to: "2026-04-01T01:20" });
assert.deepEqual(vehicleHistoryPeriod(1, new Date("2026-03-31T03:20:00Z")), { from: "2026-02-28T12:20", to: "2026-03-31T12:20" });
assert.deepEqual(vehicleHistoryPeriod(1, new Date("2024-03-31T03:20:00Z")), { from: "2024-02-29T12:20", to: "2024-03-31T12:20" });
assert.deepEqual(vehicleHistoryPeriod(3, new Date("2026-01-31T03:20:00Z")), { from: "2025-10-31T12:20", to: "2026-01-31T12:20" });
assert.equal(formatHistoryDateTime("2026-10-30T15:20:00Z"), "2026/10/31 00:20", "日本時間で日付をまたぐ");
assert.equal(formatTripDuration(0), "0分");
assert.equal(formatTripDuration(59), "59分");
assert.equal(formatTripDuration(120), "2時間");
assert.equal(formatTripDuration(150), "2時間30分");
assert.equal(tripMinutes("2026-10-30T13:00:00Z", "2026-10-30T13:01:59Z"), 1, "分未満は切り捨てる");
const employee = { name: "現在の名前", employeeNumber: { code: "E009" }, department: { name: "現在の部署" } };
const vehicle = { id: "v1", name: "アクア 1", plateNumber: "品川300あ12-34", active: true, vehicleNumber: { code: "C001" } };
const csv = vehicleHistoryCsv([
  { id: "t1", status: "COMPLETED", actualStart: new Date("2026-10-30T13:20:00Z"), actualEnd: new Date("2026-10-30T15:50:00Z"), plannedEnd: new Date("2026-10-30T16:00:00Z"), returnFuelLevel: 0, snapshotCapturedAt: new Date(), employeeNameAtStart: "高橋 \"愛\"", employeeCodeAtStart: "E004", departmentNameAtStart: "営業部", vehicleNameAtStart: "旧アクア", vehicleCodeAtStart: "C001", plateNumberAtStart: "品川300あ12-34", vehicle, employee },
  { id: "t2", status: "COMPLETED", actualStart: "2026-10-29T01:00:00Z", actualEnd: "2026-10-29T02:00:00Z", plannedEnd: "2026-10-29T02:00:00Z", returnFuelLevel: null, snapshotCapturedAt: null, employeeNameAtStart: null, employeeCodeAtStart: null, departmentNameAtStart: null, vehicleNameAtStart: null, vehicleCodeAtStart: null, plateNumberAtStart: null, vehicle, employee },
  { id: "t3", status: "IN_USE", actualStart: "2026-10-31T01:00:00Z", actualEnd: null, plannedEnd: "2026-10-31T03:00:00Z", returnFuelLevel: null, snapshotCapturedAt: "2026-10-31T01:00:00Z", employeeNameAtStart: "鈴木", employeeCodeAtStart: "E005", departmentNameAtStart: "技術部", vehicleNameAtStart: "アクア 1", vehicleCodeAtStart: "C001", plateNumberAtStart: "品川300あ12-34", vehicle, employee },
]);
assert.ok(csv.startsWith("﻿"), "Excelで文字化けしないようBOMを付ける");
const csvRows = csv.slice(1).split("\r\n");
assert.equal(csvRows[0], '"利用開始","返却","利用時間（分）","状態","車両名","車両番号","ナンバー","社員番号","利用者","所属","返却時のガソリン残量","当時の登録情報"');
assert.equal(csvRows[1], '"2026/10/30 22:20","2026/10/31 00:50","150","返却済み","旧アクア","C001","品川300あ12-34","E004","高橋 ""愛""","営業部","E","保存済み"', "開始時点の情報と日本時間で書き出す");
assert.equal(csvRows[2], '"2026/10/29 10:00","2026/10/29 11:00","60","返却済み","アクア 1","C001","品川300あ12-34","E009","現在の名前","現在の部署","未記録","未保存（現在の情報）"');
assert.equal(csvRows[3], '"2026/10/31 10:00","","","利用中","アクア 1","C001","品川300あ12-34","E005","鈴木","技術部","","保存済み"', "利用中は返却・利用時間・残量を空欄にする");
console.log("Vehicle history filters passed: JST, midnight, exact moment, future, invalid ranges, pagination, duration and CSV");
