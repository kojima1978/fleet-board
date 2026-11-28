import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { guidanceDefaultAudioFiles } from "../prisma/guidance-defaults";
import { FUEL_NOTICE_AUDIO_MAX_BYTES, FUEL_NOTICE_LEVELS } from "../lib/fuel-return-notice";
import { fuelNoticeAudioSample, parkingAudioSample } from "../lib/guidance-default-audio";
import { PARKING_GUIDANCE_EVENTS } from "../lib/parking-guidance";

assert.deepEqual(guidanceDefaultAudioFiles.sort(), [
  "fuel-refueled-thank-you.wav",
  "fuel-return-empty-reminder.mp3",
  "fuel-return-low-reminder.wav",
  "parking-blocked-warning.mp3",
  "parking-customer-spot.mp3",
]);

// 「初期の音声」ボタンを出す区分と、初期データでサンプル音声を入れる区分は同じ対応表を使う。
assert.deepEqual(Object.fromEntries(PARKING_GUIDANCE_EVENTS.map((event) => [event, parkingAudioSample(event)?.fileName ?? null])), {
  DEPARTURE: null, SELECT_SPOT: null, ARRIVAL: null,
  BLOCKED_OUT: "parking-blocked-warning.mp3", BLOCKED_IN: "parking-blocked-warning.mp3", CUSTOMER_SPOT: "parking-customer-spot.mp3",
});
assert.deepEqual(FUEL_NOTICE_LEVELS.map((level) => fuelNoticeAudioSample("RETURN", level)?.fileName ?? null), [null, null, null, "fuel-return-low-reminder.wav", "fuel-return-empty-reminder.mp3"]);
assert.ok(FUEL_NOTICE_LEVELS.every((level) => fuelNoticeAudioSample("START", level) === null));

async function main() {
  for (const fileName of guidanceDefaultAudioFiles) {
    const data = await readFile(new URL(`../public/audio/${fileName}`, import.meta.url));
    assert.ok(data.length > 0, `${fileName}が空です`);
    assert.ok(data.length <= FUEL_NOTICE_AUDIO_MAX_BYTES, `${fileName}が2MBを超えています`);
  }
  console.log("Guidance default audio tests passed: bundled files exist, fit the upload limit and match each guidance");
}

void main();
