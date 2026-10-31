import { z } from "zod";
import { noticeAudioSchema } from "./fuel-return-notice";

export const PARKING_GUIDANCE_EVENTS = ["DEPARTURE", "SELECT_SPOT", "ARRIVAL", "BLOCKED_OUT", "BLOCKED_IN"] as const;
export type ParkingGuidanceEvent = (typeof PARKING_GUIDANCE_EVENTS)[number];
export const parkingGuidanceEvent = z.enum(PARKING_GUIDANCE_EVENTS);
export const PARKING_GUIDANCE_AUDIO_MAX_BYTES = 2 * 1024 * 1024;

export const parkingGuidanceLabels: Record<ParkingGuidanceEvent, { label: string; hint: string; defaultMessage: string }> = {
  DEPARTURE: { label: "出庫を開始", hint: "利用開始または車検開始で、車を駐車場から出すとき", defaultMessage: "車を出します。周囲の安全を確認してください。" },
  SELECT_SPOT: { label: "駐車区画を選択", hint: "返却・車検終了・位置変更で、配置図から区画を選ぶとき", defaultMessage: "車を停める駐車区画を選択してください。" },
  ARRIVAL: { label: "入庫内容を確認", hint: "駐車区画を選び、ガソリン残量などを確認するとき", defaultMessage: "駐車区画と周囲の安全を確認してください。" },
  BLOCKED_OUT: { label: "出庫できない", hint: "手前の区画に車があり、そのまま出庫できないとき", defaultMessage: "手前に車があるため出庫できません。先に手前の車を移動してください。" },
  BLOCKED_IN: { label: "入庫できない", hint: "手前の区画に車があり、そのまま入庫できないとき", defaultMessage: "手前に車があるため入庫できません。先に手前の車を移動してください。" },
};

export type ParkingGuidanceSetting = { event: ParkingGuidanceEvent; enabled: boolean; message: string; version: number; audioName: string | null; audioUrl: string | null };
export const defaultParkingGuidanceSetting = (event: ParkingGuidanceEvent): ParkingGuidanceSetting => ({
  event,
  enabled: event === "BLOCKED_OUT" || event === "BLOCKED_IN",
  message: parkingGuidanceLabels[event].defaultMessage,
  version: 0,
  audioName: null,
  audioUrl: null,
});
export const parkingGuidanceUpdateSchema = z.object({ event: parkingGuidanceEvent, enabled: z.boolean(), message: z.string().trim().min(1).max(300), version: z.number().int().nonnegative(), audio: noticeAudioSchema.nullable().optional() }).strict();
