import type { Prisma } from "@/prisma/generated/client";
import { validateNoticeAudio } from "./fuel-return-notice-store";

type NoticeAudioInput = { base64: string; fileName: string } | null | undefined;
export type NoticeAudioFile = { data: Uint8Array<ArrayBuffer>; mime: string; name: string };

// 送られた音声を検証して保存用の形にする。undefinedは変更なし、nullは音声を外す。
export function parseNoticeAudio(input: NoticeAudioInput): NoticeAudioFile | null | undefined {
  if (!input) return input;
  return { data: new Uint8Array(Buffer.from(input.base64, "base64")), mime: validateNoticeAudio(input.base64), name: input.fileName };
}

// 設定の音声を差し替える値を返す。古い音声はdeleteUnusedNoticeAudioで消す。
export async function noticeAudioData(tx: Prisma.TransactionClient, audio: NoticeAudioFile | null | undefined) {
  if (audio === undefined) return {};
  if (audio === null) return { audioId: null };
  return { audioId: (await tx.noticeAudio.create({ data: audio, select: { id: true } })).id };
}

// どの設定からも参照されなくなった音声を消す。
export function deleteUnusedNoticeAudio(tx: Prisma.TransactionClient) {
  return tx.noticeAudio.deleteMany({ where: { fuelReturnNotice: { is: null }, fuelStartNotice: { is: null }, fuelThankYouSetting: { is: null }, parkingGuidanceSetting: { is: null } } });
}

export const noticeAudioResponse = (audio: { data: Uint8Array<ArrayBuffer>; mime: string }, cacheControl: string) =>
  new Response(audio.data, { headers: { "Content-Type": audio.mime, "Cache-Control": cacheControl, "X-Content-Type-Options": "nosniff" } });
