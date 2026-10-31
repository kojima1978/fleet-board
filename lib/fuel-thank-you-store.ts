import { prisma } from "./prisma";
import { defaultFuelThankYouSetting, type FuelThankYouSetting } from "./fuel-thank-you";

export async function readFuelThankYouSetting(): Promise<FuelThankYouSetting> {
  const row = await prisma.fuelThankYouSetting.findUnique({ where: { id: "default" }, select: { enabled: true, audioEnabled: true, message: true, version: true, audioName: true, audioMime: true } });
  if (!row) return defaultFuelThankYouSetting();
  return { enabled: row.enabled, audioEnabled: row.audioEnabled, message: row.message, version: row.version, audioName: row.audioName, audioUrl: row.audioMime ? `/api/settings/fuel-thank-you/audio?v=${row.version}` : null };
}
