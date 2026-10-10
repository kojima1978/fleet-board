import { NextResponse } from "next/server";
import { z } from "zod";
import { ADMIN_COOKIE, adminTokenFromRequest, createAdminToken, verifyAdminPin, verifyAdminToken } from "@/lib/admin-auth";
import { checkRateLimit, clearRateLimit, consumeRateLimit, isSameOriginRequest, readJsonBody, requestClientKey } from "@/lib/request-security";

export const dynamic = "force-dynamic";
const bodySchema = z.object({ pin: z.string().regex(/^\d{4,12}$/) });

export async function GET(request: Request) {
  return NextResponse.json({ authenticated: verifyAdminToken(adminTokenFromRequest(request)) });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: "許可されていない送信元です" }, { status: 403 });
  const key = requestClientKey(request);
  const now = Date.now();
  const rate = checkRateLimit("admin-login", key, 5);
  if (!rate.allowed) return NextResponse.json({ message: "試行回数が多すぎます。5分後に再試行してください" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  const parsed = bodySchema.safeParse(await readJsonBody(request, 1_024).catch(() => null));
  if (!parsed.success || !verifyAdminPin(parsed.data.pin)) {
    const failed = consumeRateLimit("admin-login", key, 5, 5 * 60_000);
    return NextResponse.json({ message: failed.allowed ? "管理者PINが正しくありません" : "5回失敗したため、5分間ロックしました" }, { status: failed.allowed ? 401 : 429, headers: failed.allowed ? undefined : { "Retry-After": String(failed.retryAfterSeconds) } });
  }
  clearRateLimit("admin-login", key);
  const response = NextResponse.json({ authenticated: true });
  response.cookies.set(ADMIN_COOKIE, createAdminToken(now), { httpOnly: true, sameSite: "strict", secure: process.env.FLEETFLOW_COOKIE_SECURE === "true", path: "/", maxAge: 8 * 60 * 60 });
  return response;
}

export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: "許可されていない送信元です" }, { status: 403 });
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
  return response;
}
