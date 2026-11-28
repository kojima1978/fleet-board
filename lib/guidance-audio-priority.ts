"use client";

let parkingAudio: HTMLAudioElement | null = null;
// ガソリン案内は音声ファイルのほか、ファイルがないときの読み上げ（SpeechSynthesisUtterance）でも流す。
type FuelGuidanceSound = HTMLAudioElement | SpeechSynthesisUtterance;
let fuelAudio: FuelGuidanceSound | null = null;
let stopOperationSound: (() => void) | null = null;

function interruptOperationSound() {
  const stop = stopOperationSound;
  stopOperationSound = null;
  stop?.();
}

export function beginOperationSound(stop: () => void) {
  const speech = typeof window === "undefined" ? undefined : window.speechSynthesis;
  if (parkingAudio || fuelAudio || speech?.speaking || speech?.pending) return false;
  interruptOperationSound();
  stopOperationSound = stop;
  return true;
}

export function endOperationSound(stop: () => void) {
  if (stopOperationSound === stop) stopOperationSound = null;
}

const cancelSpeech = () => {
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
};

export function beginParkingGuidance(audio: HTMLAudioElement | null) {
  // ガソリン案内の再生開始から終了までは、駐車案内を割り込ませない。
  if (fuelAudio) return false;
  interruptOperationSound();
  if (parkingAudio !== audio) parkingAudio?.pause();
  parkingAudio = audio;
  cancelSpeech();
  return true;
}

export function endParkingGuidance(audio: HTMLAudioElement) {
  if (parkingAudio === audio) parkingAudio = null;
}

export function createGuidanceUtterance(text: string) {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ja-JP";
  utterance.rate = 0.95;
  return utterance;
}

export function beginFuelGuidance(audio: FuelGuidanceSound) {
  interruptOperationSound();
  // 給油のお願いを聞き逃さないよう、再生中の駐車案内を停止する。
  parkingAudio?.pause();
  parkingAudio = null;
  cancelSpeech();
  if (fuelAudio && fuelAudio !== audio && "pause" in fuelAudio) fuelAudio.pause();
  fuelAudio = audio;
}

export function endFuelGuidance(audio: FuelGuidanceSound) {
  if (fuelAudio === audio) fuelAudio = null;
}

export async function playGuidancePreview(audio: HTMLAudioElement, kind: "parking" | "fuel") {
  if (!audio.paused) {
    audio.currentTime = 0;
    return;
  }
  if (kind === "fuel") beginFuelGuidance(audio);
  else if (!beginParkingGuidance(audio)) throw new Error("給油案内の再生中です");

  const finish = () => {
    audio.removeEventListener("pause", finish);
    audio.removeEventListener("ended", finish);
    audio.removeEventListener("error", finish);
    if (kind === "fuel") endFuelGuidance(audio);
    else endParkingGuidance(audio);
  };
  audio.addEventListener("pause", finish);
  audio.addEventListener("ended", finish);
  audio.addEventListener("error", finish);
  try {
    audio.currentTime = 0;
    await audio.play();
  } catch (error) {
    finish();
    throw error;
  }
}
