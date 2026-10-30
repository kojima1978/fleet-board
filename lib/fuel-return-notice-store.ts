import { prisma } from "./prisma";
import { defaultFuelReturnNotice, FUEL_NOTICE_AUDIO_MAX_BYTES, fuelNoticeDisplayMode, fuelNoticeLegacyFlags, type FuelNoticeLevel, type FuelNoticePhase, type FuelReturnNotice } from "./fuel-return-notice";

export function validateNoticeAudio(base64: string) {
  const data = Buffer.from(base64, "base64");
  if (!data.length || data.length > FUEL_NOTICE_AUDIO_MAX_BYTES || data.toString("base64") !== base64) throw new Error("音声は2MB以内のMP3・WAVを指定してください");
  if (data.length >= 44 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WAVE") return "audio/wav";
  if (data.length >= 10 && (data.toString("ascii", 0, 3) === "ID3" || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0 && (data[1] & 0x06) !== 0))) return "audio/mpeg";
  throw new Error("MP3・WAV形式の音声ファイルを指定してください");
}
const noticeSelect = { level: true, displayMode: true, enabled: true, animated: true, audioEnabled: true, message: true, version: true, audioName: true, audioMime: true } as const;
export async function readFuelNotice(level: FuelNoticeLevel, phase: FuelNoticePhase): Promise<FuelReturnNotice> {
  const row = phase === "START" ? await prisma.fuelStartNotice.findUnique({ where: { level }, select: noticeSelect }) : await prisma.fuelReturnNotice.findUnique({ where: { level }, select: noticeSelect });
  if (!row) return defaultFuelReturnNotice(level, phase);
  const displayMode = fuelNoticeDisplayMode.catch(row.enabled ? (row.animated ? "MODAL" : "MESSAGE") : "NONE").parse(row.displayMode);
  return { phase, level, displayMode, ...fuelNoticeLegacyFlags(displayMode), audioEnabled: row.audioEnabled, message: row.message, version: row.version, audioName: row.audioName, audioUrl: row.audioMime ? `/api/settings/fuel-return/${level}/audio?phase=${phase}&v=${row.version}` : null };
}
export const readFuelReturnNotice = (level: FuelNoticeLevel) => readFuelNotice(level, "RETURN");
