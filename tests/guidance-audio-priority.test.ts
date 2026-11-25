import assert from "node:assert/strict";
import { beginFuelGuidance, beginOperationSound, beginParkingGuidance, endFuelGuidance, endOperationSound, endParkingGuidance } from "../lib/guidance-audio-priority";

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

let stopped = 0;
const stop = () => { stopped += 1; };
assert.equal(beginOperationSound(stop), true, "案内がなければ効果音を鳴らせる");
assert.equal(beginParkingGuidance(parking.audio), true);
assert.equal(stopped, 1, "駐車案内が始まったら鳴っている効果音を停止する");
assert.equal(beginOperationSound(stop), false, "駐車案内の再生中は効果音を開始しない");
endParkingGuidance(parking.audio);

assert.equal(beginOperationSound(stop), true);
beginFuelGuidance(fuel.audio);
assert.equal(stopped, 2, "給油案内が始まったら鳴っている効果音を停止する");
assert.equal(beginOperationSound(stop), false, "給油案内の再生中は効果音を開始しない");
endFuelGuidance(fuel.audio);
assert.equal(beginOperationSound(stop), true);
endOperationSound(stop);

console.log("Guidance audio priority tests passed");
