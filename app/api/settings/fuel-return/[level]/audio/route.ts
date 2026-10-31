import { prisma } from "@/lib/prisma";
import { noticeAudioResponse } from "@/lib/notice-audio-store";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ level: string }> }) {
  const { level } = await context.params;
  const numericLevel = Number(level);
  if (!Number.isInteger(numericLevel) || numericLevel < 0 || numericLevel > 4) return new Response(null, { status: 404 });
  const phase = new URL(request.url).searchParams.get("phase")?.toUpperCase() === "START" ? "START" : "RETURN";
  const notice = phase === "START" ? await prisma.fuelStartNotice.findUnique({ where: { level: numericLevel }, select: { audio: { select: { data: true, mime: true } } } }) : await prisma.fuelReturnNotice.findUnique({ where: { level: numericLevel }, select: { audio: { select: { data: true, mime: true } } } });
  if (!notice?.audio) return new Response(null, { status: 404 });
  return noticeAudioResponse(notice.audio, "no-store");
}
