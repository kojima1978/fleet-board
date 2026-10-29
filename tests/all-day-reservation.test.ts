import assert from "node:assert/strict";
import { allDayDates, allDayStart } from "../lib/all-day-reservation";

const before = new Date("2026-10-29T05:59:59+09:00");
const boundary = new Date("2026-10-29T06:00:00+09:00");
const afternoon = new Date("2026-10-29T15:00:00+09:00");
assert.equal(allDayDates(before).min, "2026-10-29");
assert.equal(allDayDates(before).max, "2026-11-04", "7日後の6時が予約上限より後なら除外");
assert.ok(allDayDates(before).choices[0].label.startsWith("今日"));
assert.equal(allDayDates(boundary).min, "2026-10-30", "6時ちょうどに今日を除外");
const dates = allDayDates(afternoon);
assert.deepEqual(dates.choices.map((day) => day.date), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]);
assert.match(dates.choices[0].label, /明日.*10\/30.*金/);
assert.equal(dates.max, "2026-11-05");
for (const now of [before, boundary, afternoon]) {
  const options = allDayDates(now);
  assert.equal(options.choices.length, 7);
  assert.equal(options.choices.at(-1)?.date, options.max);
  for (const day of options.choices) assert.ok(allDayStart(day.date, now), "すべての候補が予約可能");
}
assert.equal(allDayStart("2026-10-29", afternoon), null);
assert.equal(allDayStart("2026-11-06", afternoon), null);
assert.equal(allDayStart("", afternoon), null);
assert.equal(allDayStart("2026-02-30", new Date("2026-02-28T15:00:00+09:00")), null);
assert.equal(allDayStart("2026-11-05", afternoon)?.toISOString(), "2026-11-04T21:00:00.000Z");
assert.deepEqual(allDayDates(new Date("2028-02-28T15:00:00+09:00")).choices.slice(0, 2).map((day) => day.date), ["2028-02-29", "2028-03-01"]);
assert.equal(allDayDates(new Date("2026-12-31T15:00:00+09:00")).min, "2027-01-01");
console.log("All-day reservation dates passed: JST 06:00 boundary, all available dates, month/year/leap boundaries and seven-day limits");
