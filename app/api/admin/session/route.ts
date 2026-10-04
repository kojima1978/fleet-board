import { NextResponse } from "next/server";
import { z } from "zod";
import { ADMIN_COOKIE, adminTokenFromRequest, createAdminToken, verifyAdminPin, verifyAdminToken } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
const attempts = new Map<string, { count: number; blockedUntil: number }>();
const bodySchema = z.object({ pin: z.string().regex(/^\d{4,12}$/) });

export async function GET(request: Request) {
  return NextResponse.json({ authenticated: verifyAdminToken(adminTokenFromRequest(request)) });
}

export async function POST(request: Request) {
  const key = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const current = attempts.get(key);
  if (current && current.blockedUntil > now) return NextResponse.json({ message: "試行回数が多すぎます。5分後に再試行してください" }, { status: 429 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !verifyAdminPin(parsed.data.pin)) {
    const count = (current?.count ?? 0) + 1;
    attempts.set(key, { count, blockedUntil: count >= 5 ? now + 5 * 60_000 : 0 });
    return NextResponse.json({ message: count >= 5 ? "5回失敗したため、5分間ロックしました" : "管理者PINが正しくありません" }, { status: 401 });
  }
  attempts.delete(key);
  const response = NextResponse.json({ authenticated: true });
  response.cookies.set(ADMIN_COOKIE, createAdminToken(now), { httpOnly: true, sameSite: "strict", secure: process.env.FLEETFLOW_COOKIE_SECURE === "true", path: "/", maxAge: 8 * 60 * 60 });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
  return response;
}
