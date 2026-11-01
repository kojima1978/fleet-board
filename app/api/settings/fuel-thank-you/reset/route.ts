import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readFuelThankYouSetting } from "@/lib/fuel-thank-you-store";
import { consumeRateLimit, isSameOriginRequest, requestClientKey } from "@/lib/request-security";
import { resetFuelThankYouDefault } from "@/prisma/guidance-defaults";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: "送信元を確認できません" }, { status: 403 });
  if (!consumeRateLimit("fuel-thank-you-reset", requestClientKey(request), 5, 60_000).allowed) return NextResponse.json({ message: "操作が多すぎます。少し待ってください" }, { status: 429 });
  try {
    await prisma.$transaction(async (tx) => {
      await resetFuelThankYouDefault(tx);
      await tx.auditLog.create({ data: { actorName: "設定画面", action: "給油時のお礼初期化", targetType: "FuelThankYouSetting", targetId: "default", description: "給油時のお礼とサンプル音声を初期設定へ戻しました" } });
    });
    return NextResponse.json({ setting: await readFuelThankYouSetting() });
  } catch {
    return NextResponse.json({ message: "給油時のお礼を初期設定へ戻せませんでした" }, { status: 500 });
  }
}
