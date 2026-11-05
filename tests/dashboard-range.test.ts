import assert from "node:assert/strict";
import { parseDashboardRangeDays } from "../lib/dashboard-range";

for (const days of [1, 3, 7, 30, 90] as const) assert.equal(parseDashboardRangeDays(String(days)), days, `${days}日を受け付ける`);
for (const invalid of [null, "", "0", "2", "31", "365", "invalid"]) assert.equal(parseDashboardRangeDays(invalid), 3, `${String(invalid)}は3日へ戻す`);

console.log("Dashboard range tests passed: timeline 1/3 days and schedule list 7/30/90 days");
