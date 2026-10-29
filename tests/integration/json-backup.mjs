import assert from "node:assert/strict";

const appUrl = process.env.APP_URL || "http://app:3000";
const origin = new URL(appUrl).origin;
const exported = await fetch(`${appUrl}/api/admin/data`);
if (!exported.ok) throw new Error(`JSON書き出し失敗: ${exported.status} ${await exported.text()}`);
assert.match(exported.headers.get("content-disposition") ?? "", /fleetflow-data-\d{8}\.json/);
const backup = await exported.json();
assert.equal(backup.format, "fleetflow-json-backup");
assert.equal(backup.formatVersion, 1);
assert.ok(backup.data.employees.every((item) => item.qrToken), "社員QR識別子を保存する");
assert.ok(backup.data.vehicles.every((item) => item.qrToken), "車両QR識別子を保存する");
const originalCounts = Object.fromEntries(Object.entries(backup.data).map(([key, rows]) => [key, rows.length]));

const post = async (body) => {
  const response = await fetch(`${appUrl}/api/admin/data`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });
  return { response, result: await response.json() };
};

const validated = await post({ mode: "validate", backup });
assert.equal(validated.response.status, 200, JSON.stringify(validated.result));
assert.deepEqual(validated.result.counts, originalCounts);

const legacyBackup = structuredClone(backup);
for (const item of legacyBackup.data.employees) delete item.qrToken;
for (const item of legacyBackup.data.vehicles) {
  delete item.qrToken;
  delete item.hasWinterTires;
}
const legacyValidated = await post({ mode: "validate", backup: legacyBackup });
assert.equal(legacyValidated.response.status, 200, "QR識別子と冬タイヤ項目がない旧バックアップも検査できる");

const crossOrigin = await fetch(`${appUrl}/api/admin/data`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://evil.example" }, body: JSON.stringify({ mode: "validate", backup }) });
assert.equal(crossOrigin.status, 403, "別Originからの復元を拒否する");

const invalid = structuredClone(backup);
invalid.data.employees.push({ id: "invalid-reference-test", employeeNumberId: "missing", departmentId: "missing", name: "不正参照", active: false, version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
const rejected = await post({ mode: "validate", backup: invalid });
assert.equal(rejected.response.status, 400, "参照切れのデータを拒否する");

const unconfirmed = await post({ mode: "restore", confirmation: "", backup });
assert.equal(unconfirmed.response.status, 400, "確認入力なしの復元を拒否する");

const restored = await post({ mode: "restore", confirmation: "RESTORE", backup });
assert.equal(restored.response.status, 200, JSON.stringify(restored.result));
assert.deepEqual(restored.result.counts, originalCounts);

const afterResponse = await fetch(`${appUrl}/api/admin/data`);
if (!afterResponse.ok) throw new Error(`復元後のJSON書き出し失敗: ${afterResponse.status} ${await afterResponse.text()}`);
const after = await afterResponse.json();
for (const [key, count] of Object.entries(originalCounts)) {
  assert.equal(after.data[key].length, key === "auditLogs" ? count + 1 : count, `${key}を同じ件数で復元する`);
}
assert.ok(after.data.auditLogs.some((log) => log.action === "JSON一括復元" && log.targetId === backup.exportedAt));
console.log("JSON backup integration passed: export, validation, invalid references, confirmation and transactional restore");
