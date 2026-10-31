import { z } from "zod";
import { noticeAudioSchema } from "./fuel-return-notice";

export const FUEL_THANK_YOU_DEFAULT_MESSAGE = "給油ありがとうございます！";
export type FuelThankYouSetting = { enabled: boolean; audioEnabled: boolean; message: string; version: number; audioName: string | null; audioUrl: string | null };
export const defaultFuelThankYouSetting = (): FuelThankYouSetting => ({ enabled: true, audioEnabled: true, message: FUEL_THANK_YOU_DEFAULT_MESSAGE, version: 0, audioName: null, audioUrl: null });
export const wasRefueled = (previousLevel: number | null | undefined, returnedLevel: number) => previousLevel !== null && previousLevel !== undefined && returnedLevel > previousLevel;
export const fuelThankYouUpdateSchema = z.object({ enabled: z.boolean(), audioEnabled: z.boolean(), message: z.string().trim().min(1).max(300), version: z.number().int().nonnegative(), audio: noticeAudioSchema.nullable().optional() }).strict();
