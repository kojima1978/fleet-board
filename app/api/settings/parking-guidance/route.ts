import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { PARKING_GUIDANCE_EVENTS, parkingGuidanceLabels, parkingGuidanceUpdateSchema } from "@/lib/parking-guidance";
import { readParkingGuidance } from "@/lib/parking-guidance-store";
import { validateNoticeAudio } from "@/lib/fuel-return-notice-store";
import { consumeRateLimit, isSameOriginRequest, readJsonBody, requestClientKey } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ settings: await Promise.all(PARKING_GUIDANCE_EVENTS.map(readParkingGuidance)) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: "送信元を確認できません" }, { status: 403 });
  if (!consumeRateLimit("parking-guidance-settings", requestClientKey(request), 20, 60_000).allowed) return NextResponse.json({ message: "操作が多すぎます。少し待ってください" }, { status: 429 });
  try {
    const input = parkingGuidanceUpdateSchema.parse(await readJsonBody(request, 3 * 1024 * 1024));
    const audio = input.audio === undefined ? {} : input.audio === null ? { audioBase64: null, audioMime: null, audioName: null } : { audioBase64: input.audio.base64, audioMime: validateNoticeAudio(input.audio.base64), audioName: input.audio.fileName };
    await prisma.$transaction(async (tx) => {
      const data = { enabled: input.enabled, message: input.message, ...audio };
      if (input.version === 0) await tx.parkingGuidanceSetting.create({ data: { event: input.event, ...data } });
      else {
        const result = await tx.parkingGuidanceSetting.updateMany({ where: { event: input.event, version: input.version }, data: { ...data, version: { increment: 1 } } });
        if (result.count !== 1) throw new Error("CONFLICT");
      }
      await tx.auditLog.create({ data: { actorName: "設定画面", action: "駐車音声案内変更", targetType: "ParkingGuidanceSetting", targetId: input.event, description: `${parkingGuidanceLabels[input.event].label}を${input.enabled ? "音声あり" : "音声なし"}に設定${input.audio !== undefined ? "・音声ファイルを変更" : ""}` } });
    });
    return NextResponse.json({ setting: await readParkingGuidance(input.event) });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "P2002" || (error as Error).message === "CONFLICT") return NextResponse.json({ message: "他の端末で変更されています。再読み込みしてやり直してください" }, { status: 409 });
    if ((error as Error).message === "REQUEST_TOO_LARGE") return NextResponse.json({ message: "音声ファイルは2MB以内にしてください" }, { status: 413 });
    return NextResponse.json({ message: error instanceof z.ZodError ? "案内文は1〜300文字、音声は2MB以内のMP3・WAVで指定してください" : code ? "設定を保存できませんでした" : (error as Error).message }, { status: code ? 500 : 400 });
  }
}
