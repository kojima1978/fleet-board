import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { normalizeNfcUid } from "@/lib/nfc";
import { consumeRateLimit, isSameOriginRequest, readJsonBody, requestClientKey } from "@/lib/request-security";

export const dynamic = "force-dynamic";
const schema = z.object({ uid: z.string().trim().min(1).max(100).transform(normalizeNfcUid) });

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: "許可されていない送信元です" }, { status: 403 });
  const rate = consumeRateLimit("nfc-resolve", requestClientKey(request), 120, 60_000);
  if (!rate.allowed) return NextResponse.json({ message: "読み取り回数が多すぎます" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  let body: unknown;
  try { body = await readJsonBody(request, 2_048); }
  catch (error) { return NextResponse.json({ message: error instanceof Error && error.message === "REQUEST_TOO_LARGE" ? "入力が大きすぎます" : "入力内容を確認してください" }, { status: error instanceof Error && error.message === "REQUEST_TOO_LARGE" ? 413 : 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ message: "NFC UIDを確認してください" }, { status: 400 });
  const assignment = await prisma.nfcAssignment.findFirst({
    where: { validTo: null, nfcTag: { uid: { equals: parsed.data.uid, mode: "insensitive" } }, OR: [{ employee: { active: true } }, { vehicle: { active: true } }] },
    select: { employeeId: true, vehicleId: true },
  });
  if (assignment?.employeeId) return NextResponse.json({ kind: "employee", id: assignment.employeeId });
  if (assignment?.vehicleId) return NextResponse.json({ kind: "vehicle", id: assignment.vehicleId });
  return NextResponse.json({ message: "登録されていないNFCタグです" }, { status: 404 });
}
