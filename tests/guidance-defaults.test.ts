import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { guidanceDefaultAudioFiles } from "../prisma/guidance-defaults";
import { FUEL_NOTICE_AUDIO_MAX_BYTES } from "../lib/fuel-return-notice";

assert.deepEqual(guidanceDefaultAudioFiles.sort(), [
  "fuel-refueled-thank-you.wav",
  "fuel-return-empty-reminder.mp3",
  "fuel-return-low-reminder.wav",
  "parking-blocked-warning.mp3",
]);

async function main() {
  for (const fileName of guidanceDefaultAudioFiles) {
    const data = await readFile(new URL(`../public/audio/${fileName}`, import.meta.url));
    assert.ok(data.length > 0, `${fileName}が空です`);
    assert.ok(data.length <= FUEL_NOTICE_AUDIO_MAX_BYTES, `${fileName}が2MBを超えています`);
  }
  console.log("Guidance default audio tests passed: bundled files exist and fit the upload limit");
}

void main();
