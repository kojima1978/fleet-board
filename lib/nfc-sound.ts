"use client";

// NFCを読み取ったときの短い効果音。音声ファイルは使わずWeb Audioで鳴らす。
// ブラウザーの自動再生制限により、画面を一度も操作していないと鳴らないことがある。
import { isNfcSoundEnabled } from "./device-mode";

let context: AudioContext | null = null;

const TONES = {
  success: { type: "sine", notes: [[1320, 0], [1760, 0.09]] },
  error: { type: "square", notes: [[440, 0], [330, 0.15]] },
} as const;

export function playNfcSound(kind: keyof typeof TONES) {
  if (typeof window === "undefined" || typeof window.AudioContext !== "function" || !isNfcSoundEnabled()) return;
  try {
    context ??= new window.AudioContext();
    if (context.state === "suspended") void context.resume();
    const tone = TONES[kind];
    for (const [frequency, offset] of tone.notes) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + offset;
      oscillator.type = tone.type;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(kind === "error" ? 0.08 : 0.2, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.13);
    }
  } catch {
    // 効果音は補助なので、鳴らせなくても操作は続ける。
  }
}
