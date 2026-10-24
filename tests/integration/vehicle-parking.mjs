import assert from "node:assert/strict";
import pg from "pg";
import { freeRecordCodes } from "./record-codes.mjs";

const appUrl = process.env.APP_URL || "http://app:3000";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const suffix = Date.now().toString(36);
let codes = [];
const plates = Array.from({ length: 14 }, (_, i) => `PK${suffix}${i}`);
// 6・7はテスト用の仮置き区画。既存の仮置き区画はテスト中だけ無効にして、選ばれる区画を固定する。
const spots = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `parking-test-${suffix}-${i}`);
const holdingSpots = [spots[6], spots[7]];
let realHoldingSpots = [];
const operationIds = [];
async function post(body) {
  const operationId = crypto.randomUUID();
  operationIds.push(operationId);
  const response = await fetch(`${appUrl}/api/dashboard`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: new URL(appUrl).origin },
    body: JSON.stringify({ operationId, ...body }),
  });
  return { status: response.status, body: await response.json() };
}
const create = (i, spotId) => post({ action: "createVehicle", code: codes[i], name: `駐車登録テスト${i}`, plateNumber: plates[i], color: "#2563eb", nfcUid: "", ...(spotId ? { spotId } : {}) });
const spotRow = async (id) => (await client.query('SELECT * FROM "ParkingSpot" WHERE id=$1', [id])).rows[0];
const updateSpot = async (id, changes, version) => { const row = await spotRow(id); return post({ action: "updateSpot", id, version: version ?? row.version, code: row.code, label: row.label, role: row.role, dedicatedVehicleId: row.dedicatedVehicleId, ...changes }); };
const setRole = (id, role, dedicatedVehicleId = null, version) => updateSpot(id, { role, dedicatedVehicleId }, version);
const importItem = (i, spotId) => ({ code: codes[i], name: `駐車取込テスト${i}`, plateNumber: plates[i], ...(spotId ? { spotId } : {}) });
const importVehicles = (items) => post({ action: "importVehicles", items });
const setActive = async (i, active) => { const row = await vehicle(i); return post({ action: "setVehicleActive", id: row.id, version: row.version, active }); };
async function vehicle(i) {
  const { rows } = await client.query('SELECT v.* FROM "Vehicle" v JOIN "VehicleNumber" n ON n.id=v."vehicleNumberId" WHERE n.code=$1', [codes[i]]);
  return rows[0];
}

await client.connect();
try {
  codes = await freeRecordCodes(client, "VehicleNumber", "Y", 14);
  for (const [i, id] of spots.entries()) {
    await client.query('INSERT INTO "ParkingSpot" (id,code,x,y,width,height,orientation,enabled,version) VALUES ($1,$2,0,0,5,5,\'horizontal\',$3,1)', [id, `P${suffix}${i}`, i !== 2]);
  }
  realHoldingSpots = (await client.query('UPDATE "ParkingSpot" SET enabled=false WHERE role=\'HOLDING\' AND enabled RETURNING id')).rows.map((row) => row.id);
  await client.query('UPDATE "ParkingSpot" SET role=\'HOLDING\' WHERE id=ANY($1::text[])', [holdingSpots]);
  const first = await create(0, spots[0]);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  let created = await vehicle(0);
  assert.equal(created.parkingSpotId, spots[0], "通常登録時に駐車区画を保存する");
  const edited = await post({ action: "updateVehicle", id: created.id, version: created.version, name: "NFCなし編集", plateNumber: plates[0], color: "#059669", nfcUid: "" });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal((await vehicle(0)).parkingSpotId, spots[0], "NFCなしで編集しても位置を保持する");
  assert.equal((await create(1, spots[0])).status, 400, "使用中区画への登録を拒否する");
  assert.equal(await vehicle(1), undefined, "失敗時に車両だけ作成しない");
  assert.equal((await create(2, spots[2])).status, 400, "無効区画への登録を拒否する");
  assert.equal((await create(3, `missing-${suffix}`)).status, 400, "存在しない区画への登録を拒否する");
  const concurrent = await Promise.all([create(4, spots[1]), create(5, spots[1])]);
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 400], "同時登録でも1区画に1台だけ配置する");
  assert.equal((await create(6)).status, 400, "区画を選ばない登録は拒否する");
  assert.equal((await create(6, holdingSpots[0])).status, 200, "仮置き区画を選んで登録できる");
  const unlocated = await vehicle(6);
  assert.equal(unlocated.parkingSpotId, holdingSpots[0]);
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
  const owner = await vehicle(0);
  assert.equal((await setRole(spots[0], "DEDICATED", unlocated.id)).status, 400, "他の車が駐車中の区画は専用にできない");
  assert.equal((await setRole(spots[3], "DEDICATED")).status, 400, "専用には車両の指定が必要");
  const staleVersion = (await spotRow(spots[3])).version;
  const dedicated = await setRole(spots[3], "DEDICATED", owner.id);
  assert.equal(dedicated.status, 200, JSON.stringify(dedicated.body));
  assert.equal((await setRole(spots[3], "TEMPORARY", null, staleVersion)).status, 409, "古い区画バージョンを拒否する");
  const placed = await vehicle(6);
  assert.equal((await post({ action: "moveVehicle", vehicleId: placed.id, version: placed.version, spotId: spots[3] })).status, 400, "専用区画に他の車は移動できない");
  assert.equal((await create(7, spots[3])).status, 400, "専用区画に新規車両を登録できない");
  const ownerMove = await post({ action: "moveVehicle", vehicleId: owner.id, version: owner.version, spotId: spots[3] });
  assert.equal(ownerMove.status, 200, JSON.stringify(ownerMove.body));
  const roleData = await (await fetch(`${appUrl}/api/dashboard`)).json();
  const dedicatedSpot = roleData.spots.find((spot) => spot.id === spots[3]);
  assert.deepEqual([dedicatedSpot.role, dedicatedSpot.dedicatedVehicleId, dedicatedSpot.dedicatedVehicleName], ["DEDICATED", owner.id, "NFCなし編集"], "配置図に専用車両名を返す");
  assert.equal((await setRole(spots[3], "REGULAR")).status, 200);
  assert.equal((await spotRow(spots[3])).dedicatedVehicleId, null, "通常へ戻すと専用車両を外す");
  assert.equal((await setRole(spots[3], "REGULAR")).status, 400, "変更なしは拒否する");
  assert.equal((await updateSpot(spots[3], { code: `P${suffix}0` })).status, 400, "使用中の区画番号への変更を拒否する");
  assert.equal((await updateSpot(spots[3], { code: "  " })).status, 400, "空の区画番号を拒否する");
  assert.equal((await updateSpot(spots[3], { code: "A 1" })).status, 400, "空白を含む区画番号を拒否する");
  const renamed = await updateSpot(spots[3], { code: `　Ｒ${suffix}　` });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
  assert.equal((await spotRow(spots[3])).code, `R${suffix}`, "区画番号を全角から半角へそろえて変更する");
  const renameRace = await Promise.all([updateSpot(spots[4], { code: `S${suffix}` }), updateSpot(spots[5], { code: `S${suffix}` })]);
  assert.deepEqual(renameRace.map((r) => r.status).sort(), [200, 400], "同時に同じ区画番号へは1区画だけ変更できる");
  const both = await updateSpot(spots[3], { code: `T${suffix}`, role: "TEMPORARY" });
  assert.equal(both.status, 200, JSON.stringify(both.body));
  assert.deepEqual([(await spotRow(spots[3])).code, (await spotRow(spots[3])).role], [`T${suffix}`, "TEMPORARY"], "区画番号と用途を一度に変更する");
  assert.equal((await setRole(spots[3], "REGULAR")).status, 200);
  assert.equal((await updateSpot(spots[3], { label: "あいうえおかきくけこさ" })).status, 400, "長すぎる表示名を拒否する");
  const labeled = await updateSpot(spots[3], { label: " 社長車専用 " });
  assert.equal(labeled.status, 200, JSON.stringify(labeled.body));
  assert.equal((await spotRow(spots[3])).label, "社長車専用", "表示名だけを変更する");
  assert.equal((await (await fetch(`${appUrl}/api/dashboard`)).json()).spots.find((spot) => spot.id === spots[3]).label, "社長車専用", "配置図に表示名を返す");
  assert.equal((await updateSpot(spots[3], { label: "　" })).status, 200);
  assert.equal((await spotRow(spots[3])).label, null, "空欄の表示名は自動表示へ戻す");
  assert.equal((await importVehicles([importItem(8, spots[4]), importItem(9, spots[4])])).status, 400, "JSON内で同じ区画の割当を拒否する");
  assert.equal((await importVehicles([importItem(8, spots[4]), importItem(9, spots[2])])).status, 400, "使用中区画への取込を拒否する");
  assert.equal((await importVehicles([importItem(8, spots[4]), importItem(9, `missing-${suffix}`)])).status, 400, "存在しない区画への取込を拒否する");
  assert.equal(await vehicle(8), undefined, "取込に失敗したら1台も登録しない");
  await client.query('UPDATE "ParkingSpot" SET enabled=false WHERE id=$1', [spots[5]]);
  assert.equal((await importVehicles([importItem(8, spots[5])])).status, 400, "無効区画への取込を拒否する");
  await client.query('UPDATE "ParkingSpot" SET enabled=true WHERE id=$1', [spots[5]]);
  const imported = await importVehicles([importItem(8, spots[4]), importItem(9, spots[5]), importItem(10)]);
  assert.equal(imported.status, 200, JSON.stringify(imported.body));
  assert.equal((await vehicle(8)).parkingSpotId, spots[4], "JSON取込で区画を割り当てる");
  assert.equal((await vehicle(9)).parkingSpotId, spots[5], "JSON取込で複数の区画を割り当てる");
  assert.equal((await vehicle(10)).parkingSpotId, null, "区画を選ばない行は位置未設定で登録する");
  assert.equal((await create(11, holdingSpots[0])).status, 200);
  assert.equal((await create(12, holdingSpots[1])).status, 200);
  assert.equal((await create(13, holdingSpots[0])).status, 400, "使用中の仮置き区画への登録を拒否する");
  const freedSpot = (await vehicle(11)).parkingSpotId;
  assert.equal((await setActive(11, false)).status, 200);
  assert.equal((await vehicle(11)).parkingSpotId, null, "利用停止で区画を空ける");
  assert.equal((await setActive(11, true)).status, 200);
  assert.equal((await vehicle(11)).parkingSpotId, freedSpot, "利用再開で空いている仮置き区画に置く");
  assert.equal((await setActive(11, false)).status, 200);
  assert.equal((await create(13, freedSpot)).status, 200, "仮置きが空けば登録できる");
  assert.equal((await setActive(11, true)).status, 200, "仮置きが埋まっていても利用再開はできる");
  assert.equal((await vehicle(11)).parkingSpotId, null, "仮置きが埋まっていたら位置未設定で再開する");
  console.log("Vehicle parking passed: registration without NFC, edit, occupied/disabled/missing spots, concurrent registration, required spot, holding spots, later placement, stale version, map data, spot roles and numbers, resume and JSON import with spots");
} finally {
  await client.query('DELETE FROM "AuditLog" WHERE "operationId"=ANY($1::text[])', [operationIds]);
  await client.query('DELETE FROM "Vehicle" WHERE "vehicleNumberId" IN (SELECT id FROM "VehicleNumber" WHERE code=ANY($1::text[]))', [codes]);
  await client.query('DELETE FROM "VehicleNumber" WHERE code=ANY($1::text[])', [codes]);
  await client.query('DELETE FROM "ParkingSpot" WHERE id=ANY($1::text[])', [spots]);
  await client.query('UPDATE "ParkingSpot" SET enabled=true WHERE id=ANY($1::text[])', [realHoldingSpots]);
  await client.end();
}
