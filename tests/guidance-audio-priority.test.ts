import assert from "node:assert/strict";
import { beginFuelGuidance, beginParkingGuidance, endFuelGuidance, endParkingGuidance } from "../lib/guidance-audio-priority";

const fakeAudio = () => {
  let pauses = 0;
  return {
    audio: { pause: () => { pauses += 1; } } as HTMLAudioElement,
    pauses: () => pauses,
  };
};

const parking = fakeAudio();
const fuel = fakeAudio();
assert.equal(beginParkingGuidance(parking.audio), true, "駐車案内は通常再生できる");
beginFuelGuidance(fuel.audio);
assert.equal(parking.pauses(), 1, "ガソリン案内開始時に駐車案内を停止する");

const blockedParking = fakeAudio();
assert.equal(beginParkingGuidance(blockedParking.audio), false, "ガソリン案内中は新しい駐車案内を開始しない");
assert.equal(blockedParking.pauses(), 0);

endFuelGuidance(fuel.audio);
assert.equal(beginParkingGuidance(blockedParking.audio), true, "ガソリン案内終了後は駐車案内を再び開始できる");
endParkingGuidance(blockedParking.audio);

console.log("Guidance audio priority tests passed: fuel interrupts and blocks parking guidance");
