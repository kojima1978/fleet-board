import { prisma } from "./prisma";
import { defaultParkingGuidanceSetting, type ParkingGuidanceEvent, type ParkingGuidanceSetting } from "./parking-guidance";

export async function readParkingGuidance(event: ParkingGuidanceEvent): Promise<ParkingGuidanceSetting> {
  const row = await prisma.parkingGuidanceSetting.findUnique({ where: { event }, select: { event: true, enabled: true, message: true, version: true, audioName: true, audioMime: true } });
  if (!row) return defaultParkingGuidanceSetting(event);
  return { event, enabled: row.enabled, message: row.message, version: row.version, audioName: row.audioName, audioUrl: row.audioMime ? `/api/settings/parking-guidance/${event}/audio?v=${row.version}` : null };
}
