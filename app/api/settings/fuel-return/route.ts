import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { FUEL_NOTICE_LEVELS, fuelNoticeDisplayModeLabel, fuelNoticeLegacyFlags, fuelNoticePhase, fuelNoticeUpdateSchema } from "@/lib/fuel-return-notice";
import { formatFuelLevel } from "@/lib/fuel-level";
import { readFuelNotice, validateNoticeAudio } from "@/lib/fuel-return-notice-store";
import { consumeRateLimit, isSameOriginRequest, readJsonBody, requestClientKey } from "@/lib/request-security";

export const dynamic = "force-dynamic";
export async function GET(request: Request = new Request("http://localhost/api/settings/fuel-return")) {
  const phase = fuelNoticePhase.catch("RETURN").parse(new URL(request.url).searchParams.get("phase")?.toUpperCase());
  return NextResponse.json({ notices: await Promise.all(FUEL_NOTICE_LEVELS.map((level) => readFuelNotice(level, phase))) }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: "送信元を確認できません" }, { status: 403 });
  if (!consumeRateLimit("fuel-return-settings", requestClientKey(request), 20, 60_000).allowed) return NextResponse.json({ message: "操作が多すぎます。少し待ってください" }, { status: 429 });
  try {
    const input = fuelNoticeUpdateSchema.parse(await readJsonBody(request, 3 * 1024 * 1024));
    const audio = input.audio === undefined ? {} : input.audio === null ? { audioBase64: null, audioMime: null, audioName: null } : { audioBase64: input.audio.base64, audioMime: validateNoticeAudio(input.audio.base64), audioName: input.audio.fileName };
    await prisma.$transaction(async (tx) => {
      const data = { displayMode: input.displayMode, ...fuelNoticeLegacyFlags(input.displayMode), audioEnabled: input.audioEnabled, message: input.message, ...audio };
      if (input.version === 0) {
        if (input.phase === "START") await tx.fuelStartNotice.create({ data: { level: input.level, ...data } });
        else await tx.fuelReturnNotice.create({ data: { level: input.level, ...data } });
      } else {
        const result = input.phase === "START" ? await tx.fuelStartNotice.updateMany({ where: { level: input.level, version: input.version }, data: { ...data, version: { increment: 1 } } }) : await tx.fuelReturnNotice.updateMany({ where: { level: input.level, version: input.version }, data: { ...data, version: { increment: 1 } } });
        if (result.count !== 1) throw new Error("CONFLICT");
      }
      await tx.auditLog.create({ data: { actorName: "設定画面", action: `${input.phase === "START" ? "利用開始時" : "返却時"}ガソリン案内変更`, targetType: input.phase === "START" ? "FuelStartNotice" : "FuelReturnNotice", targetId: String(input.level), description: `${formatFuelLevel(input.level)}を${fuelNoticeDisplayModeLabel[input.displayMode]}・音声${input.audioEnabled ? "あり" : "なし"}に設定${input.audio !== undefined ? "・音声ファイルを変更" : ""}` } });
    });
    return NextResponse.json({ notice: await readFuelNotice(input.level, input.phase) });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "P2002" || (error as Error).message === "CONFLICT") return NextResponse.json({ message: "他の端末で変更されています。再読み込みしてやり直してください" }, { status: 409 });
    if ((error as Error).message === "REQUEST_TOO_LARGE") return NextResponse.json({ message: "音声ファイルは2MB以内にしてください" }, { status: 413 });
    return NextResponse.json({ message: error instanceof z.ZodError ? "メッセージは1〜500文字、音声は2MB以内のMP3・WAVで指定してください" : code ? "設定を保存できませんでした" : (error as Error).message }, { status: code ? 500 : 400 });
  }
}
