import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { noticeAudioResponse } from "@/lib/notice-audio-store";
import { parkingGuidanceEvent } from "@/lib/parking-guidance";

export async function GET(_request: Request, context: { params: Promise<{ event: string }> }) {
  const parsed = parkingGuidanceEvent.safeParse((await context.params).event);
  if (!parsed.success) return new NextResponse(null, { status: 404 });
  const setting = await prisma.parkingGuidanceSetting.findUnique({ where: { event: parsed.data }, select: { audio: { select: { data: true, mime: true } } } });
  if (!setting?.audio) return new NextResponse(null, { status: 404 });
  return noticeAudioResponse(setting.audio, "private, max-age=31536000, immutable");
}
