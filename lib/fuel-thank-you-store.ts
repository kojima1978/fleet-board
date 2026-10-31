import { prisma } from "./prisma";
import { defaultFuelThankYouSetting, type FuelThankYouSetting } from "./fuel-thank-you";

export async function readFuelThankYouSetting(): Promise<FuelThankYouSetting> {
  const row = await prisma.fuelThankYouSetting.findUnique({ where: { id: "default" }, select: { enabled: true, audioEnabled: true, message: true, version: true, audio: { select: { name: true } } } });
  if (!row) return defaultFuelThankYouSetting();
  return { enabled: row.enabled, audioEnabled: row.audioEnabled, message: row.message, version: row.version, audioName: row.audio?.name ?? null, audioUrl: row.audio ? `/api/settings/fuel-thank-you/audio?v=${row.version}` : null };
}
