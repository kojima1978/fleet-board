import assert from "node:assert/strict";
import pg from "pg";

const appUrl = process.env.APP_URL || "http://app:3000";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const suffix = Date.now().toString(36);
const codes = Array.from({ length: 8 }, (_, i) => `PK${suffix}${i}`);
const spots = [0, 1, 2].map((i) => `parking-test-${suffix}-${i}`);
const operationIds = [];
let cookie;
async function post(body) {
  const operationId = crypto.randomUUID();
  operationIds.push(operationId);
  const response = await fetch(`${appUrl}/api/dashboard`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: new URL(appUrl).origin, Cookie: cookie },
    body: JSON.stringify({ operationId, ...body }),
  });
  return { status: response.status, body: await response.json() };
}
const create = (i, spotId) => post({ action: "createVehicle", code: codes[i], name: `駐車登録テスト${i}`, plateNumber: codes[i], color: "#2563eb", nfcUid: "", ...(spotId ? { spotId } : {}) });
async function vehicle(i) {
  const { rows } = await client.query('SELECT v.* FROM "Vehicle" v JOIN "VehicleNumber" n ON n.id=v."vehicleNumberId" WHERE n.code=$1', [codes[i]]);
  return rows[0];
}

await client.connect();
try {
  const login = await fetch(`${appUrl}/api/admin/session`, { method: "POST", headers: { "Content-Type": "application/json", Origin: new URL(appUrl).origin }, body: JSON.stringify({ pin: process.env.FLEETFLOW_ADMIN_PIN }) });
  assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie);
  for (const [i, id] of spots.entries()) {
    await client.query('INSERT INTO "ParkingSpot" (id,code,x,y,width,height,orientation,enabled,version) VALUES ($1,$2,0,0,5,5,\'horizontal\',$3,1)', [id, `P${suffix}${i}`, i !== 2]);
  }
  const first = await create(0, spots[0]);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  let created = await vehicle(0);
  assert.equal(created.parkingSpotId, spots[0], "通常登録時に駐車区画を保存する");
  const edited = await post({ action: "updateVehicle", id: created.id, version: created.version, name: "NFCなし編集", plateNumber: codes[0], color: "#059669", nfcUid: "" });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal((await vehicle(0)).parkingSpotId, spots[0], "NFCなしで編集しても位置を保持する");
  assert.equal((await create(1, spots[0])).status, 400, "使用中区画への登録を拒否する");
  assert.equal(await vehicle(1), undefined, "失敗時に車両だけ作成しない");
  assert.equal((await create(2, spots[2])).status, 400, "無効区画への登録を拒否する");
  assert.equal((await create(3, `missing-${suffix}`)).status, 400, "存在しない区画への登録を拒否する");
  const concurrent = await Promise.all([create(4, spots[1]), create(5, spots[1])]);
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 400], "同時登録でも1区画に1台だけ配置する");
  assert.equal((await create(6)).status, 200, "後で位置を設定する登録も維持する");
  const unlocated = await vehicle(6);
  assert.equal(unlocated.parkingSpotId, null);
  assert.equal((await post({ action: "moveVehicle", vehicleId: unlocated.id, version: unlocated.version, spotId: spots[2] })).status, 400, "無効区画への後設定を拒否する");
  assert.equal((await post({ action: "moveVehicle", vehicleId: unlocated.id, version: unlocated.version, spotId: spots[0] })).status, 400, "使用中区画への後設定を拒否する");
  await client.query('UPDATE "ParkingSpot" SET enabled=true WHERE id=$1', [spots[2]]);
  const moved = await post({ action: "moveVehicle", vehicleId: unlocated.id, version: unlocated.version, spotId: spots[2] });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal((await vehicle(6)).parkingSpotId, spots[2], "駐車位置未確定車両に後から設定できる");
  assert.equal((await post({ action: "moveVehicle", vehicleId: unlocated.id, version: unlocated.version, spotId: spots[2] })).status, 409, "古い車両バージョンを拒否する");
  const publicResponse = await fetch(`${appUrl}/api/dashboard`);
  const data = await publicResponse.json();
  assert.equal(data.spots.find((spot) => spot.id === spots[2]).vehicle.id, unlocated.id, "配置図のデータにも反映する");
  console.log("Vehicle parking passed: registration without NFC, edit, occupied/disabled/missing spots, concurrent registration, later placement, stale version and map data");
} finally {
  await client.query('DELETE FROM "AuditLog" WHERE "operationId"=ANY($1::text[])', [operationIds]);
  await client.query('DELETE FROM "Vehicle" WHERE "vehicleNumberId" IN (SELECT id FROM "VehicleNumber" WHERE code=ANY($1::text[]))', [codes]);
  await client.query('DELETE FROM "VehicleNumber" WHERE code=ANY($1::text[])', [codes]);
  await client.query('DELETE FROM "ParkingSpot" WHERE id=ANY($1::text[])', [spots]);
  await client.end();
}
