import assert from "node:assert/strict";

const appUrl = process.env.APP_URL || "http://app:3000";
const origin = new URL(appUrl).origin;
const dashboardResponse = await fetch(`${appUrl}/api/dashboard`);
if (!dashboardResponse.ok) throw new Error(`ダッシュボード取得失敗: ${dashboardResponse.status} ${await dashboardResponse.text()}`);
const dashboard = await dashboardResponse.json();

const resolve = async (value, requestOrigin = origin) => {
  const response = await fetch(`${appUrl}/api/qr/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: requestOrigin },
    body: JSON.stringify({ value }),
  });
  return { response, body: await response.json() };
};

for (const [kind, item] of [["employee", dashboard.employees[0]], ["vehicle", dashboard.vehicles[0]]]) {
  assert.ok(item?.qrCode, `${kind}のQRコードが発行されている`);
  const resolved = await resolve(item.qrCode);
  assert.equal(resolved.response.status, 200, JSON.stringify(resolved.body));
  assert.deepEqual(resolved.body, { kind, id: item.id });

  const image = await fetch(`${appUrl}/api/qr/${kind}/${item.id}`);
  assert.equal(image.status, 200);
  assert.match(image.headers.get("content-type") ?? "", /^image\/svg\+xml/);
  assert.match(image.headers.get("cache-control") ?? "", /no-store/, "再発行後に旧QRをキャッシュ表示しない");
  assert.match(await image.text(), /<svg/);
}

const invalid = await resolve("NOT-A-FLEETFLOW-CODE");
assert.equal(invalid.response.status, 400, "FleetFlow以外のQRコードを拒否する");

const crossOrigin = await resolve(dashboard.employees[0].qrCode, "http://evil.example");
assert.equal(crossOrigin.response.status, 403, "別OriginからのQR解決を拒否する");

const employee = dashboard.employees.find((item) => item.active);
assert.ok(employee, "QR再発行を確認できる有効な社員がいる");
const previousQr = employee.qrCode;
const rotateResponse = await fetch(`${appUrl}/api/dashboard`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: origin },
  body: JSON.stringify({ operationId: crypto.randomUUID(), action: "rotateEmployeeQr", id: employee.id, version: employee.version }),
});
assert.equal(rotateResponse.status, 200, await rotateResponse.text());
const rotatedDashboardResponse = await fetch(`${appUrl}/api/dashboard`);
assert.equal(rotatedDashboardResponse.status, 200);
const rotatedDashboard = await rotatedDashboardResponse.json();
const rotatedEmployee = rotatedDashboard.employees.find((item) => item.id === employee.id);
assert.ok(rotatedEmployee);
assert.notEqual(rotatedEmployee.qrCode, previousQr, "再発行でQR識別子が変わる");
assert.equal((await resolve(previousQr)).response.status, 404, "旧QRは再発行後に無効になる");
assert.equal((await resolve(rotatedEmployee.qrCode)).response.status, 200, "新QRは再発行後に利用できる");

const mailStatus = await fetch(`${appUrl}/api/qr/email`);
assert.equal(mailStatus.status, 200);
const mailConfiguration = await mailStatus.json();
assert.equal(typeof mailConfiguration.configured, "boolean", "SMTP設定状態を取得できる");
const crossOriginMail = await fetch(`${appUrl}/api/qr/email`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://evil.example" }, body: JSON.stringify({ employeeIds: [employee.id] }) });
assert.equal(crossOriginMail.status, 403, "別Originからのメール送信を拒否する");
if (!mailConfiguration.configured) {
  const unavailableMail = await fetch(`${appUrl}/api/qr/email`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ employeeIds: [employee.id] }) });
  assert.equal(unavailableMail.status, 503, "SMTP未設定時は送信せず案内する");
}

console.log("QR integration passed: employee, vehicle, SVG, rotation, mail status, invalid code and cross-origin rejection");
