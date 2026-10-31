import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parkingGuidanceEvent } from "@/lib/parking-guidance";

export async function GET(_request: Request, context: { params: Promise<{ event: string }> }) {
  const parsed = parkingGuidanceEvent.safeParse((await context.params).event);
  if (!parsed.success) return new NextResponse(null, { status: 404 });
  const setting = await prisma.parkingGuidanceSetting.findUnique({ where: { event: parsed.data }, select: { audioBase64: true, audioMime: true } });
  if (!setting?.audioBase64 || !setting.audioMime) return new NextResponse(null, { status: 404 });
  return new NextResponse(Buffer.from(setting.audioBase64, "base64"), { headers: { "Content-Type": setting.audioMime, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
}
