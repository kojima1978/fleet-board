import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { parseQrPayload } from "@/lib/qr-code";
import { consumeRateLimit, isSameOriginRequest, readJsonBody, requestClientKey } from "@/lib/request-security";

export const dynamic = "force-dynamic";
const schema = z.object({ value: z.string().trim().min(1).max(256) });

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: "許可されていない送信元です" }, { status: 403 });
  const rate = consumeRateLimit("qr-resolve", requestClientKey(request), 120, 60_000);
  if (!rate.allowed) return NextResponse.json({ message: "読み取り回数が多すぎます" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  let body: unknown;
  try { body = await readJsonBody(request, 2_048); }
  catch (error) { return NextResponse.json({ message: error instanceof Error && error.message === "REQUEST_TOO_LARGE" ? "入力が大きすぎます" : "入力内容を確認してください" }, { status: error instanceof Error && error.message === "REQUEST_TOO_LARGE" ? 413 : 400 }); }
  const parsed = schema.safeParse(body);
  const qr = parsed.success ? parseQrPayload(parsed.data.value) : null;
  if (!qr) return NextResponse.json({ message: "FleetFlow用のQRコードではありません" }, { status: 400 });
  if (qr.kind === "employee") {
    const employee = await prisma.employee.findFirst({ where: { qrToken: qr.token, active: true }, select: { id: true } });
    return employee ? NextResponse.json({ kind: "employee", id: employee.id }) : NextResponse.json({ message: "登録されていない社員QRです" }, { status: 404 });
  }
  const vehicle = await prisma.vehicle.findFirst({ where: { qrToken: qr.token, active: true }, select: { id: true } });
  return vehicle ? NextResponse.json({ kind: "vehicle", id: vehicle.id }) : NextResponse.json({ message: "登録されていない車両QRです" }, { status: 404 });
}
