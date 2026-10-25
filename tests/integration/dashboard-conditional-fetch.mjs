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

console.log("Dashboard conditional fetch passed: ETag, 304 and changed-version response");
