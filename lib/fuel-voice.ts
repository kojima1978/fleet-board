"use client";

import { isNfcSoundEnabled } from "./device-mode";

const FUEL_RETURN_VOICE_PATH = "/audio/fuel-return-reminder.wav";

let voice: HTMLAudioElement | null = null;

export function stopFuelReturnVoice() {
  if (!voice) return;
  voice.pause();
  voice.currentTime = 0;
}

export function playFuelReturnVoice() {
  if (typeof window === "undefined" || typeof window.Audio !== "function" || !isNfcSoundEnabled()) return;
  try {
    voice ??= new window.Audio(FUEL_RETURN_VOICE_PATH);
    stopFuelReturnVoice();
    voice.volume = 0.9;
    void voice.play().catch(() => {
      // 音声は補助なので、再生できなくても返却操作は続ける。
    });
  } catch {
    // 音声は補助なので、再生できなくても返却操作は続ける。
  }
}
