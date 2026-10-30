import assert from "node:assert/strict";
import { prisma } from "../../lib/prisma";
import { GET as settings, POST as save } from "../../app/api/settings/fuel-return/route";
import { GET as audio } from "../../app/api/settings/fuel-return/[level]/audio/route";
import { POST as action } from "../../app/api/dashboard/route";
import { createFleetBackup, parseFleetBackup, restoreFleetBackup } from "../../lib/json-backup";
import { FUEL_NOTICE_AUDIO_MAX_BYTES } from "../../lib/fuel-return-notice";

const db = new URL(process.env.DATABASE_URL ?? "");
if (db.hostname !== "fleetflow-fuel-notice-test-db" || db.pathname !== "/fleet_fuel_notice_test") throw new Error("Disposable fuel notice DB only");
const wav = Buffer.alloc(844, 128);
wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write("data", 36); wav.writeUInt32LE(800, 40);
const upload = { fileName: "案内.wav", base64: wav.toString("base64") };
const request = (body: unknown, origin = "http://localhost") => new Request("http://localhost/api/settings/fuel-return", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });
async function post(body: object, operationId = crypto.randomUUID()) {
  const response = await action(request({ operationId, ...body }));
  return { status: response.status, data: await response.json() };
}
async function main() {
  try {
    assert.equal(await prisma.fuelReturnNotice.count(), 0);
    const defaults = await (await settings()).json();
    assert.deepEqual(defaults.notices.map((notice: { level: number }) => notice.level), [4, 3, 2, 1, 0]);
    assert.deepEqual(defaults.notices.map((notice: { enabled: boolean }) => notice.enabled), [false, false, false, true, true]);
    assert.deepEqual(defaults.notices.map((notice: { displayMode: string }) => notice.displayMode), ["NONE", "NONE", "NONE", "MODAL", "MODAL"]);
    assert.equal(defaults.notices[0].version, 0);
    const base = { level: 0, version: 0, displayMode: "MODAL", audioEnabled: true, message: "Eの案内テスト", audio: upload };
    assert.equal((await save(request(base, "http://evil.invalid"))).status, 403);
    for (const change of [{ level: 5 }, { message: " " }, { audio: { ...upload, base64: Buffer.from("<html>bad</html>").toString("base64") } }, { audio: { ...upload, base64: Buffer.alloc(FUEL_NOTICE_AUDIO_MAX_BYTES + 1).toString("base64") } }]) assert.equal((await save(request({ ...base, ...change }))).status, 400);
    let response = await save(request(base)); assert.equal(response.status, 200);
    const first = (await response.json()).notice;
    assert.equal(first.version, 1); assert.equal(first.audioName, upload.fileName); assert.equal(first.audioBase64, undefined);
    const sound = await audio(new Request("http://localhost"), { params: Promise.resolve({ level: "0" }) });
    assert.equal(sound.status, 200); assert.equal(sound.headers.get("Content-Type"), "audio/wav"); assert.deepEqual(Buffer.from(await sound.arrayBuffer()), wav);
    assert.equal((await save(request(base))).status, 409, "stale create rejected");
    response = await save(request({ ...base, version: 1, displayMode: "NONE", audioEnabled: false, audio: undefined })); assert.equal(response.status, 200); assert.equal((await response.json()).notice.audioEnabled, false);
    assert.equal((await prisma.fuelReturnNotice.findUniqueOrThrow({ where: { level: 0 } })).audioBase64, upload.base64, "text-only save keeps audio");
    assert.equal((await save(request({ ...base, level: 1, message: "1/4の案内テスト" }))).status, 200);
    assert.equal((await save(request({ ...base, level: 4, displayMode: "MESSAGE", audioEnabled: false, message: "Fの案内テスト", audio: undefined }))).status, 200);

    const department = await prisma.department.create({ data: { name: "案内テスト" } });
    const employee = await prisma.employee.create({ data: { name: "案内テスト社員", qrToken: crypto.randomUUID(), department: { connect: { id: department.id } }, employeeNumber: { create: { code: "E901" } } } });
    const spot = await prisma.parkingSpot.create({ data: { code: "Test1", x: 1, y: 1, width: 5, height: 5, orientation: "vertical" } });
    const vehicle = await prisma.vehicle.create({ data: { name: "案内テスト車", plateNumber: "案内901", qrToken: crypto.randomUUID(), vehicleNumber: { create: { code: "C901" } }, parkingSpot: { connect: { id: spot.id } } } });
    for (const level of [0, 1, 2, 4, null]) {
      const started = await post({ action: "start", employeeId: employee.id, vehicleId: vehicle.id, minutes: 60, actorEmployeeId: employee.id });
      assert.equal(started.status, 200); assert.equal(started.data.fuelReturnNotice, undefined);
      const trip = await prisma.trip.findFirstOrThrow({ where: { vehicleId: vehicle.id, status: "IN_USE" } });
      const car = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
      const end = { action: "end", tripId: trip.id, tripVersion: trip.version, vehicleId: car.id, vehicleVersion: car.version, spotId: spot.id, fuelLevel: level };
      const failed = await post({ ...end, tripVersion: 999 });
      assert.equal(failed.status, 409); assert.equal(failed.data.fuelReturnNotice, undefined);
      const operationId = crypto.randomUUID();
      const result = await post(end, operationId); assert.equal(result.status, 200);
      if (level === 1) {
        assert.equal(result.data.fuelReturnNotice.message, "1/4の案内テスト");
        assert.ok(result.data.fuelReturnNotice.audioUrl);
        const replay = await post(end, operationId); assert.equal(replay.data.replayed, true); assert.equal(replay.data.fuelReturnNotice.level, 1);
      } else if (level === 4) { assert.equal(result.data.fuelReturnNotice.message, "Fの案内テスト"); assert.equal(result.data.fuelReturnNotice.displayMode, "MESSAGE"); assert.equal(result.data.fuelReturnNotice.animated, false); assert.equal(result.data.fuelReturnNotice.audioEnabled, false); }
      else assert.equal(result.data.fuelReturnNotice, undefined, "disabled/other/unknown level has no notice");
    }
    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { status: "MAINTENANCE", parkingSpotId: null } });
    await prisma.vehicleMaintenance.create({ data: { vehicleId: vehicle.id, kind: "OFF_SITE", status: "ACTIVE", plannedStart: new Date(Date.now() - 300_000), actualStart: new Date(Date.now() - 300_000), plannedEnd: new Date(Date.now() + 3_600_000) } });
    const maintained = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
    const returnedMaintenance = await post({ action: "endMaintenance", vehicleId: vehicle.id, version: maintained.version, spotId: spot.id, fuelLevel: 1 });
    assert.equal(returnedMaintenance.status, 200); assert.equal(returnedMaintenance.data.fuelReturnNotice.message, "1/4の案内テスト");
    const backup = parseFleetBackup(await createFleetBackup());
    assert.equal(backup.data.fuelReturnNotices.length, 3);
    const old = JSON.parse(JSON.stringify(backup)); delete old.data.fuelReturnNotices;
    assert.deepEqual(parseFleetBackup(old).data.fuelReturnNotices, []);
    const oldWithoutAnimation = JSON.parse(JSON.stringify(backup)); for (const notice of oldWithoutAnimation.data.fuelReturnNotices) delete notice.animated;
    assert.ok(parseFleetBackup(oldWithoutAnimation).data.fuelReturnNotices.every((notice) => notice.animated), "旧バックアップは強調ONとして復元");
    const oldWithoutDisplayMode = JSON.parse(JSON.stringify(backup)); for (const notice of oldWithoutDisplayMode.data.fuelReturnNotices) delete notice.displayMode;
    assert.deepEqual(parseFleetBackup(oldWithoutDisplayMode).data.fuelReturnNotices.map((notice) => notice.displayMode), ["NONE", "MODAL", "MESSAGE"], "旧バックアップは有効・強調設定から表示方法を復元");
    const oldWithoutAudioToggle = JSON.parse(JSON.stringify(backup)); for (const notice of oldWithoutAudioToggle.data.fuelReturnNotices) delete notice.audioEnabled;
    assert.ok(parseFleetBackup(oldWithoutAudioToggle).data.fuelReturnNotices.every((notice) => notice.audioEnabled), "旧バックアップは音声ONとして復元");
    const broken = JSON.parse(JSON.stringify(backup)); broken.data.fuelReturnNotices[0].audioMime = null;
    assert.throws(() => parseFleetBackup(broken));
    const duplicate = JSON.parse(JSON.stringify(backup)); duplicate.data.fuelReturnNotices = [backup.data.fuelReturnNotices[0], backup.data.fuelReturnNotices[0]];
    assert.throws(() => parseFleetBackup(duplicate));
    assert.equal((await save(request({ ...base, version: 2, audio: null }))).status, 200);
    assert.equal((await audio(new Request("http://localhost"), { params: Promise.resolve({ level: "0" }) })).status, 404);
    await restoreFleetBackup(backup);
    assert.equal((await prisma.fuelReturnNotice.findUniqueOrThrow({ where: { level: 0 } })).audioBase64, upload.base64);
    await restoreFleetBackup(parseFleetBackup(old));
    assert.equal(await prisma.fuelReturnNotice.count(), 0);
    console.log("Fuel notices passed: defaults, origin/size/type checks, audio, optimistic save, successful return only, disabled levels, replay and old/new backup round trips");
  } finally { await prisma.$disconnect(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
