import assert from "node:assert/strict";

const baseUrl = process.env.APP_URL ?? "http://localhost:3000";
const origin = new URL(baseUrl).origin;

const unauthorized = await fetch(`${baseUrl}/api/operations`, { cache: "no-store" });
assert.equal(unauthorized.status, 401, "operations must require admin authentication");

const login = await fetch(`${baseUrl}/api/admin/session`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: origin },
  body: JSON.stringify({ pin: process.env.FLEETFLOW_ADMIN_PIN ?? "2468" }),
});
assert.equal(login.status, 200, "admin login must succeed");
const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
assert.ok(cookie, "admin cookie must be returned");

const response = await fetch(`${baseUrl}/api/operations?page=1`, { headers: { Cookie: cookie }, cache: "no-store" });
assert.equal(response.status, 200, "operations list must load");
const data = await response.json();
assert.ok(Array.isArray(data.logs), "logs must be an array");
assert.ok(Array.isArray(data.actions), `actions must be an array; received keys: ${Object.keys(data).join(", ")}`);
assert.equal(typeof data.system.schemaVersion, "string", "schema version must be returned");

const csvResponse = await fetch(`${baseUrl}/api/operations?format=csv`, { headers: { Cookie: cookie }, cache: "no-store" });
assert.equal(csvResponse.status, 200, "CSV export must succeed");
assert.match(csvResponse.headers.get("content-type") ?? "", /text\/csv/);
const csv = await csvResponse.text();
assert.ok(csv.includes('"日時","利用者","操作","対象","内容"'), "CSV header must be present");

console.log("Operations integration passed: authentication, system status, filters and CSV export");
