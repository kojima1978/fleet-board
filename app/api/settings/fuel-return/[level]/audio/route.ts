import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ level: string }> }) {
  const { level } = await context.params;
  const numericLevel = Number(level);
  if (!Number.isInteger(numericLevel) || numericLevel < 0 || numericLevel > 4) return new Response(null, { status: 404 });
  const phase = new URL(request.url).searchParams.get("phase")?.toUpperCase() === "START" ? "START" : "RETURN";
  const notice = phase === "START" ? await prisma.fuelStartNotice.findUnique({ where: { level: numericLevel }, select: { audioBase64: true, audioMime: true } }) : await prisma.fuelReturnNotice.findUnique({ where: { level: numericLevel }, select: { audioBase64: true, audioMime: true } });
  if (!notice?.audioBase64 || !notice.audioMime) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(Buffer.from(notice.audioBase64, "base64")), { headers: { "Content-Type": notice.audioMime, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
