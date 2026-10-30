import { prisma } from "./prisma";
import { defaultFuelReturnNotice, FUEL_NOTICE_AUDIO_MAX_BYTES, type FuelNoticeLevel, type FuelReturnNotice } from "./fuel-return-notice";

export function validateNoticeAudio(base64: string) {
  const data = Buffer.from(base64, "base64");
  if (!data.length || data.length > FUEL_NOTICE_AUDIO_MAX_BYTES || data.toString("base64") !== base64) throw new Error("音声は2MB以内のMP3・WAVを指定してください");
  if (data.length >= 44 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WAVE") return "audio/wav";
  if (data.length >= 10 && (data.toString("ascii", 0, 3) === "ID3" || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0 && (data[1] & 0x06) !== 0))) return "audio/mpeg";
  throw new Error("MP3・WAV形式の音声ファイルを指定してください");
}
export async function readFuelReturnNotice(level: FuelNoticeLevel): Promise<FuelReturnNotice> {
  const row = await prisma.fuelReturnNotice.findUnique({ where: { level }, select: { level: true, enabled: true, animated: true, message: true, version: true, audioName: true, audioMime: true } });
  if (!row) return defaultFuelReturnNotice(level);
  return { level, enabled: row.enabled, animated: row.animated, message: row.message, version: row.version, audioName: row.audioName, audioUrl: row.audioMime ? `/api/settings/fuel-return/${level}/audio?v=${row.version}` : null };
}
