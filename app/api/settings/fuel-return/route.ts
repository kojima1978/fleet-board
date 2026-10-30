import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { fuelNoticeUpdateSchema } from "@/lib/fuel-return-notice";
import { readFuelReturnNotice, validateNoticeAudio } from "@/lib/fuel-return-notice-store";
import { consumeRateLimit, isSameOriginRequest, readJsonBody, requestClientKey } from "@/lib/request-security";

export const dynamic = "force-dynamic";
export async function GET() {
  return NextResponse.json({ notices: await Promise.all([readFuelReturnNotice(0), readFuelReturnNotice(1)]) }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: "送信元を確認できません" }, { status: 403 });
  if (!consumeRateLimit("fuel-return-settings", requestClientKey(request), 20, 60_000).allowed) return NextResponse.json({ message: "操作が多すぎます。少し待ってください" }, { status: 429 });
  try {
    const input = fuelNoticeUpdateSchema.parse(await readJsonBody(request, 3 * 1024 * 1024));
    const audio = input.audio === undefined ? {} : input.audio === null ? { audioBase64: null, audioMime: null, audioName: null } : { audioBase64: input.audio.base64, audioMime: validateNoticeAudio(input.audio.base64), audioName: input.audio.fileName };
    await prisma.$transaction(async (tx) => {
      const data = { enabled: input.enabled, message: input.message, ...audio };
      if (input.version === 0) await tx.fuelReturnNotice.create({ data: { level: input.level, ...data } });
      else {
        const result = await tx.fuelReturnNotice.updateMany({ where: { level: input.level, version: input.version }, data: { ...data, version: { increment: 1 } } });
        if (result.count !== 1) throw new Error("CONFLICT");
      }
      await tx.auditLog.create({ data: { actorName: "設定画面", action: "返却時ガソリン案内変更", targetType: "FuelReturnNotice", targetId: String(input.level), description: `${input.level === 0 ? "E" : "1/4"}の案内を${input.enabled ? "有効" : "無効"}に設定${input.audio !== undefined ? "・音声設定を変更" : ""}` } });
    });
    return NextResponse.json({ notice: await readFuelReturnNotice(input.level) });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "P2002" || (error as Error).message === "CONFLICT") return NextResponse.json({ message: "他の端末で変更されています。再読み込みしてやり直してください" }, { status: 409 });
    if ((error as Error).message === "REQUEST_TOO_LARGE") return NextResponse.json({ message: "音声ファイルは2MB以内にしてください" }, { status: 413 });
    return NextResponse.json({ message: error instanceof z.ZodError ? "メッセージは1〜500文字、音声は2MB以内のMP3・WAVで指定してください" : code ? "設定を保存できませんでした" : (error as Error).message }, { status: code ? 500 : 400 });
  }
}
