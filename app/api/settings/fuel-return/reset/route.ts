import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { FUEL_NOTICE_LEVELS, fuelNoticePhase } from "@/lib/fuel-return-notice";
import { readFuelNotice } from "@/lib/fuel-return-notice-store";
import { consumeRateLimit, isSameOriginRequest, readJsonBody, requestClientKey } from "@/lib/request-security";
import { resetFuelNoticeDefaults } from "@/prisma/guidance-defaults";

const resetSchema = z.object({ phase: fuelNoticePhase }).strict();

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: "送信元を確認できません" }, { status: 403 });
  if (!consumeRateLimit("fuel-notice-reset", requestClientKey(request), 5, 60_000).allowed) return NextResponse.json({ message: "操作が多すぎます。少し待ってください" }, { status: 429 });
  try {
    const { phase } = resetSchema.parse(await readJsonBody(request));
    await prisma.$transaction(async (tx) => {
      await resetFuelNoticeDefaults(tx, phase);
      await tx.auditLog.create({ data: { actorName: "設定画面", action: `${phase === "START" ? "利用開始時" : "返却時"}ガソリン案内初期化`, targetType: phase === "START" ? "FuelStartNotice" : "FuelReturnNotice", targetId: "all", description: `残量5段階${phase === "RETURN" ? "とサンプル音声" : ""}を初期設定へ戻しました` } });
    });
    return NextResponse.json({ notices: await Promise.all(FUEL_NOTICE_LEVELS.map((level) => readFuelNotice(level, phase))) });
  } catch (error) {
    return NextResponse.json({ message: error instanceof z.ZodError ? "初期化する案内の種類を確認してください" : "ガソリン案内を初期設定へ戻せませんでした" }, { status: error instanceof z.ZodError ? 400 : 500 });
  }
}
