import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { noticeAudioResponse } from "@/lib/notice-audio-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const row = await prisma.fuelThankYouSetting.findUnique({ where: { id: "default" }, select: { audio: { select: { data: true, mime: true } } } });
  if (!row?.audio) return NextResponse.json({ message: "音声は登録されていません" }, { status: 404 });
  return noticeAudioResponse(row.audio, "private, max-age=31536000, immutable");
}
