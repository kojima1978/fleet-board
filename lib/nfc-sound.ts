"use client";

// 読み取りと操作結果を短い電子音で知らせる。
// ブラウザーの自動再生制限により、画面を一度も操作していないと鳴らないことがある。
import { isNfcSoundEnabled } from "./device-mode";
import { beginOperationSound, endOperationSound } from "./guidance-audio-priority";

let context: AudioContext | null = null;

const TONES = {
  success: [[660, 0]],
  complete: [[660, 0], [830, 0.12], [1047, 0.24]],
  error: [[440, 0], [330, 0.15]],
} as const;

export function prepareOperationSound() {
  if (typeof window === "undefined" || typeof window.AudioContext !== "function" || !isNfcSoundEnabled()) return null;
  try {
    context ??= new window.AudioContext();
    if (context.state === "suspended") void context.resume().catch(() => {});
    return context;
  } catch {
    return null;
  }
}

export function playNfcSound(kind: keyof typeof TONES) {
  const audio = prepareOperationSound();
  if (!audio) return;
  if (audio.state === "running") playTone(audio, kind);
  else if (navigator.userActivation?.isActive) {
    void audio.resume().then(() => playTone(audio, kind)).catch(() => {});
  }
}

function playTone(audio: AudioContext, kind: keyof typeof TONES) {
  if (!isNfcSoundEnabled()) return;
  let stop: (() => void) | undefined;
  try {
    const output = audio.createGain();
    const disconnect = () => output.disconnect();
    if (!beginOperationSound(disconnect)) return;
    stop = disconnect;
    output.connect(audio.destination);
    const startTime = audio.currentTime;
    const notes = TONES[kind];
    for (const [index, [frequency, offset]] of notes.entries()) {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const start = startTime + offset;
      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(frequency * 0.85, start);
      oscillator.frequency.exponentialRampToValueAtTime(frequency, start + 0.035);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.91, start + 0.09);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(kind === "error" ? 0.06 : 0.12, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.09);
      oscillator.connect(gain).connect(output);
      if (index === notes.length - 1) {
        oscillator.onended = () => {
          endOperationSound(disconnect);
          disconnect();
        };
      }
      oscillator.start(start);
      oscillator.stop(start + 0.1);
    }
  } catch {
    if (stop) {
      endOperationSound(stop);
      stop();
    }
    // 効果音は補助なので、鳴らせなくても操作は続ける。
  }
}
