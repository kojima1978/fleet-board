import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { PARKING_GUIDANCE_EVENTS } from "@/lib/parking-guidance";
import { readParkingGuidance } from "@/lib/parking-guidance-store";
import { consumeRateLimit, isSameOriginRequest, requestClientKey } from "@/lib/request-security";
import { resetParkingGuidanceDefaults } from "@/prisma/guidance-defaults";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: "送信元を確認できません" }, { status: 403 });
  if (!consumeRateLimit("parking-guidance-reset", requestClientKey(request), 5, 60_000).allowed) return NextResponse.json({ message: "操作が多すぎます。少し待ってください" }, { status: 429 });
  try {
    await prisma.$transaction(async (tx) => {
      await resetParkingGuidanceDefaults(tx);
      await tx.auditLog.create({ data: { actorName: "設定画面", action: "駐車案内初期化", targetType: "ParkingGuidanceSetting", targetId: "all", description: "駐車案内5項目とサンプル音声を初期設定へ戻しました" } });
    });
    return NextResponse.json({ settings: await Promise.all(PARKING_GUIDANCE_EVENTS.map(readParkingGuidance)) });
  } catch {
    return NextResponse.json({ message: "駐車案内を初期設定へ戻せませんでした" }, { status: 500 });
  }
}
