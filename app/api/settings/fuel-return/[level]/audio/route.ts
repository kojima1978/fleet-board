import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ level: string }> }) {
  const { level } = await context.params;
  if (level !== "0" && level !== "1") return new Response(null, { status: 404 });
  const notice = await prisma.fuelReturnNotice.findUnique({ where: { level: Number(level) }, select: { audioBase64: true, audioMime: true } });
  if (!notice?.audioBase64 || !notice.audioMime) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(Buffer.from(notice.audioBase64, "base64")), { headers: { "Content-Type": notice.audioMime, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
