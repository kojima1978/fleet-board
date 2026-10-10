import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getBackupStatus } from "@/lib/backup-status";
import type { Prisma } from "@/prisma/generated/client";
import { adminTokenFromRequest, verifyAdminToken } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!verifyAdminToken(adminTokenFromRequest(request))) return NextResponse.json({ message: "管理者認証が必要です" }, { status: 401 });
  const url = new URL(request.url);
  const query = (url.searchParams.get("q")?.trim() ?? "").slice(0, 100);
  const page = Math.min(10_000, Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1));
  const pageSize = 50;
  const where: Prisma.AuditLogWhereInput | undefined = query ? { OR: [
      { actorName: { contains: query, mode: "insensitive" } },
      { action: { contains: query, mode: "insensitive" } },
      { description: { contains: query, mode: "insensitive" } },
    ] } : undefined;
  const [logs, total, backup] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, select: { id: true, actorName: true, action: true, targetType: true, description: true, createdAt: true } }),
    prisma.auditLog.count({ where }),
    getBackupStatus(),
  ]);
  return NextResponse.json({ logs, backup, pagination: { page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) } });
}
