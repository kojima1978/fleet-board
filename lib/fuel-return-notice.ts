import { z } from "zod";
import { FUEL_LEVEL_LABELS } from "./fuel-level";

export const FUEL_NOTICE_AUDIO_MAX_BYTES = 2 * 1024 * 1024;
export const FUEL_NOTICE_LEVELS = [4, 3, 2, 1, 0] as const;
export type FuelNoticeLevel = (typeof FUEL_NOTICE_LEVELS)[number];
export const isFuelNoticeLevel = (value: number): value is FuelNoticeLevel => FUEL_NOTICE_LEVELS.some((level) => level === value);
export const fuelNoticeLevel = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export const fuelNoticeMessage = z.string().trim().min(1).max(500);
export const FUEL_NOTICE_DISPLAY_MODES = ["NONE", "MESSAGE", "EMPHASIZED", "MODAL"] as const;
export const fuelNoticeDisplayMode = z.enum(FUEL_NOTICE_DISPLAY_MODES);
export type FuelNoticeDisplayMode = z.infer<typeof fuelNoticeDisplayMode>;
export const fuelNoticeDisplayModeLabel: Record<FuelNoticeDisplayMode, string> = { NONE: "表示なし", MESSAGE: "メッセージ", EMPHASIZED: "強調表示", MODAL: "ポップ表示" };
export const fuelNoticeLegacyFlags = (displayMode: FuelNoticeDisplayMode) => ({ enabled: displayMode !== "NONE", animated: displayMode === "EMPHASIZED" || displayMode === "MODAL" });
export type FuelReturnNotice = { level: FuelNoticeLevel; displayMode: FuelNoticeDisplayMode; enabled: boolean; animated: boolean; audioEnabled: boolean; message: string; version: number; audioName: string | null; audioUrl: string | null };
export const defaultFuelReturnNotice = (level: FuelNoticeLevel): FuelReturnNotice => ({
  level,
  displayMode: level <= 1 ? "MODAL" : "NONE",
  enabled: level <= 1,
  animated: true,
  audioEnabled: true,
  message: level === 0 ? "ガソリンがほとんどありません。次回から、可能な範囲で給油してから返却をお願いします。" : level === 1 ? "ガソリン残量が1/2未満です。次回から、可能な範囲で給油してから返却をお願いします。" : `ガソリン残量は${FUEL_LEVEL_LABELS[level]}です。`,
  version: 0,
  audioName: null,
  audioUrl: null,
});
export const noticeAudioSchema = z.object({ fileName: z.string().trim().min(1).max(100), base64: z.string().min(1).max(Math.ceil(FUEL_NOTICE_AUDIO_MAX_BYTES / 3) * 4) }).strict();
export const fuelNoticeUpdateSchema = z.object({ level: fuelNoticeLevel, displayMode: fuelNoticeDisplayMode, audioEnabled: z.boolean().default(true), message: fuelNoticeMessage, version: z.number().int().nonnegative(), audio: noticeAudioSchema.nullable().optional() }).strict();
