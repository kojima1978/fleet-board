import { z } from "zod";

export const FUEL_NOTICE_AUDIO_MAX_BYTES = 2 * 1024 * 1024;
export const fuelNoticeLevel = z.union([z.literal(0), z.literal(1)]);
export const fuelNoticeMessage = z.string().trim().min(1).max(500);
export type FuelReturnNotice = { level: 0 | 1; enabled: boolean; message: string; version: number; audioName: string | null; audioUrl: string | null };
export const defaultFuelReturnNotice = (level: 0 | 1): FuelReturnNotice => ({ level, enabled: true, message: level === 0 ? "ガソリンがほとんどありません。給油をお願いします。" : "ガソリンが少なくなっています。次回の利用時に給油をお願いします。", version: 0, audioName: null, audioUrl: null });
export const noticeAudioSchema = z.object({ fileName: z.string().trim().min(1).max(100), base64: z.string().min(1).max(Math.ceil(FUEL_NOTICE_AUDIO_MAX_BYTES / 3) * 4) }).strict();
export const fuelNoticeUpdateSchema = z.object({ level: fuelNoticeLevel, enabled: z.boolean(), message: fuelNoticeMessage, version: z.number().int().nonnegative(), audio: noticeAudioSchema.nullable().optional() }).strict();
