import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getBackupStatus } from "@/lib/backup-status";
import type { Prisma } from "@/prisma/generated/client";
import { getApplicationSystemStatus } from "@/lib/system-status";

export const dynamic = "force-dynamic";

function parseDate(value: string | null, endOfDay = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}+09:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q")?.trim() ?? "").slice(0, 100);
  const action = (url.searchParams.get("action")?.trim() ?? "").slice(0, 100);
  const from = parseDate(url.searchParams.get("from"));
  const to = parseDate(url.searchParams.get("to"), true);
  const format = url.searchParams.get("format");
  const page = Math.min(10_000, Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1));
  const pageSize = 50;
  const where: Prisma.AuditLogWhereInput = {
    ...(query ? { OR: [
      { actorName: { contains: query, mode: "insensitive" } },
      { action: { contains: query, mode: "insensitive" } },
      { description: { contains: query, mode: "insensitive" } },
    ] } : {}),
    ...(action ? { action } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };
  if (format === "csv") {
    const logs = await prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 10_000, select: { actorName: true, action: true, targetType: true, description: true, createdAt: true } });
    const rows = [
      ["日時", "利用者", "操作", "対象", "内容"].map(csvCell).join(","),
      ...logs.map((log) => [log.createdAt.toISOString(), log.actorName, log.action, log.targetType, log.description].map(csvCell).join(",")),
    ];
    return new NextResponse(`\uFEFF${rows.join("\r\n")}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="fleetflow-operations-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
  }
  const [logs, total, backup, actions, system] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, select: { id: true, actorName: true, action: true, targetType: true, description: true, createdAt: true } }),
    prisma.auditLog.count({ where }),
    getBackupStatus(),
    prisma.auditLog.findMany({ distinct: ["action"], orderBy: { action: "asc" }, select: { action: true } }),
    getApplicationSystemStatus(),
  ]);
  return NextResponse.json({ logs, backup, actions: actions.map((item) => item.action), system, pagination: { page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) } });
}
