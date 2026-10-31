import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const row = await prisma.fuelThankYouSetting.findUnique({ where: { id: "default" }, select: { audioBase64: true, audioMime: true } });
  if (!row?.audioBase64 || !row.audioMime) return NextResponse.json({ message: "音声は登録されていません" }, { status: 404 });
  return new NextResponse(Buffer.from(row.audioBase64, "base64"), { headers: { "Content-Type": row.audioMime, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
}
