"use client";

let parkingAudio: HTMLAudioElement | null = null;
let fuelAudio: HTMLAudioElement | null = null;

const cancelSpeech = () => {
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
};

export function beginParkingGuidance(audio: HTMLAudioElement | null) {
  // ガソリン案内の再生開始から終了までは、駐車案内を割り込ませない。
  if (fuelAudio) return false;
  parkingAudio?.pause();
  parkingAudio = audio;
  cancelSpeech();
  return true;
}

export function endParkingGuidance(audio: HTMLAudioElement) {
  if (parkingAudio === audio) parkingAudio = null;
}

export function beginFuelGuidance(audio: HTMLAudioElement) {
  // 給油のお願いを聞き逃さないよう、再生中の駐車案内を停止する。
  parkingAudio?.pause();
  parkingAudio = null;
  cancelSpeech();
  if (fuelAudio && fuelAudio !== audio) fuelAudio.pause();
  fuelAudio = audio;
}

export function endFuelGuidance(audio: HTMLAudioElement) {
  if (fuelAudio === audio) fuelAudio = null;
}
