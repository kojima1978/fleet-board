import type { FuelNoticeLevel, FuelNoticePhase } from "./fuel-return-notice";
import type { ParkingGuidanceEvent } from "./parking-guidance";

export type GuidanceAudioSample = { fileName: string; mime: "audio/mpeg" | "audio/wav" };

// 初期設定で登録するサンプル音声（public/audio）。
// 初期データ登録と設定画面の「初期の音声」ボタンで同じ対応表を使う。
export const guidanceAudioSamples = {
  parkingBlocked: { fileName: "parking-blocked-warning.mp3", mime: "audio/mpeg" },
  parkingCustomer: { fileName: "parking-customer-spot.mp3", mime: "audio/mpeg" },
  fuelReturnLow: { fileName: "fuel-return-low-reminder.wav", mime: "audio/wav" },
  fuelReturnEmpty: { fileName: "fuel-return-empty-reminder.mp3", mime: "audio/mpeg" },
  fuelThankYou: { fileName: "fuel-refueled-thank-you.wav", mime: "audio/wav" },
} satisfies Record<string, GuidanceAudioSample>;

export const parkingAudioSample = (event: ParkingGuidanceEvent): GuidanceAudioSample | null =>
  event === "BLOCKED_OUT" || event === "BLOCKED_IN" ? guidanceAudioSamples.parkingBlocked : event === "CUSTOMER_SPOT" ? guidanceAudioSamples.parkingCustomer : null;

export const fuelNoticeAudioSample = (phase: FuelNoticePhase, level: FuelNoticeLevel): GuidanceAudioSample | null =>
  phase !== "RETURN" ? null : level === 1 ? guidanceAudioSamples.fuelReturnLow : level === 0 ? guidanceAudioSamples.fuelReturnEmpty : null;

// サンプル音声を、利用者がファイルを選んだときと同じ形式（ファイル名とBase64）で読み込む。
export async function loadGuidanceAudioSample(sample: GuidanceAudioSample) {
  const response = await fetch(`/audio/${sample.fileName}`, { cache: "no-store" });
  if (!response.ok) throw new Error("初期の音声を読み込めませんでした");
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return { fileName: sample.fileName, base64: btoa(binary) };
}
