import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { prisma } from "@/lib/prisma";
import { qrPayload } from "@/lib/qr-code";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const qrKind = kind === "employee" ? "employee" : kind === "vehicle" ? "vehicle" : null;
  const record = qrKind === "employee"
    ? await prisma.employee.findUnique({ where: { id }, select: { qrToken: true } })
    : qrKind === "vehicle"
      ? await prisma.vehicle.findUnique({ where: { id }, select: { qrToken: true } })
      : null;
  if (!record || !qrKind) return NextResponse.json({ message: "QRコードが見つかりません" }, { status: 404 });
  const svg = await QRCode.toString(qrPayload(qrKind, record.qrToken), { type: "svg", errorCorrectionLevel: "M", margin: 2, width: 320, color: { dark: "#0f172a", light: "#ffffff" } });
  // 再発行直後にブラウザーキャッシュから旧QRを表示しない。
  return new NextResponse(svg, { headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "private, no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" } });
}
