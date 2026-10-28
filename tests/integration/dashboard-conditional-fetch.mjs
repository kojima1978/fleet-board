import assert from "node:assert/strict";

const appUrl = process.env.APP_URL || "http://127.0.0.1:3000";

const first = await fetch(`${appUrl}/api/dashboard`, { cache: "no-store" });
assert.equal(first.status, 200, await first.text());
const etag = first.headers.get("etag");
assert.ok(etag, "ダッシュボード応答にETagがありません");

const unchanged = await fetch(`${appUrl}/api/dashboard`, {
  cache: "no-store",
  headers: { "If-None-Match": etag },
});
assert.equal(unchanged.status, 304, "同じデータの再取得が304になりませんでした");
assert.equal(await unchanged.text(), "", "304応答に不要な本文があります");

const unknownVersion = await fetch(`${appUrl}/api/dashboard`, {
  cache: "no-store",
  headers: { "If-None-Match": '"unknown-version"' },
});
assert.equal(unknownVersion.status, 200, "異なるETagに最新データが返りませんでした");

const settings = await fetch(`${appUrl}/api/dashboard?scope=settings`, { cache: "no-store" });
const settingsText = await settings.text();
assert.equal(settings.status, 200, settingsText);
const settingsEtag = settings.headers.get("etag");
assert.ok(settingsEtag, "設定画面用応答にETagがありません");
const settingsPayload = JSON.parse(settingsText);
assert.ok(settingsPayload.trips.every((trip) => trip.status === "IN_USE"), "設定画面用応答に利用中以外の履歴が含まれています");
assert.deepEqual(settingsPayload.nextReservations, [], "設定画面用応答に日常画面専用の次予約が含まれています");

const simultaneous = await Promise.all(Array.from({ length: 6 }, () => fetch(`${appUrl}/api/dashboard?scope=settings`, {
  cache: "no-store",
  headers: { "If-None-Match": settingsEtag },
})));
assert.ok(simultaneous.every((response) => response.status === 304), "同時再取得の一部が304になりませんでした");

console.log("Dashboard conditional fetch passed: ETag, 304, settings scope and simultaneous fetches");
