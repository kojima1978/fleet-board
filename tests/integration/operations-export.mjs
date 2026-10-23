import assert from "node:assert/strict";

const baseUrl = process.env.APP_URL ?? "http://localhost:3000";

const response = await fetch(`${baseUrl}/api/operations?page=1`, { cache: "no-store" });
assert.equal(response.status, 200, "operations list must load");
const data = await response.json();
assert.ok(Array.isArray(data.logs), "logs must be an array");
assert.ok(Array.isArray(data.actions), `actions must be an array; received keys: ${Object.keys(data).join(", ")}`);
assert.equal(typeof data.system.schemaVersion, "string", "schema version must be returned");

const csvResponse = await fetch(`${baseUrl}/api/operations?format=csv`, { cache: "no-store" });
assert.equal(csvResponse.status, 200, "CSV export must succeed");
assert.match(csvResponse.headers.get("content-type") ?? "", /text\/csv/);
const csv = await csvResponse.text();
assert.ok(csv.includes('"日時","利用者","操作","対象","内容"'), "CSV header must be present");

console.log("Operations integration passed: system status, filters and CSV export");
