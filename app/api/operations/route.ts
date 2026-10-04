import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
const BACKUP_DIR = "/backups";

async function backupStatus() {
  try {
    const files = (await readdir(BACKUP_DIR)).filter((name) => /^fleet-\d{8}-\d{6}\.sql\.gz$/.test(name)).sort().reverse();
    const latest = files[0];
    const verifiedPath = path.join(BACKUP_DIR, ".last-verified");
    const [latestStat, verifiedStat] = await Promise.all([
      latest ? stat(path.join(BACKUP_DIR, latest)) : null,
      stat(verifiedPath).catch(() => null),
    ]);
    return {
      latestFile: latest ?? null,
      latestAt: latestStat?.mtime.toISOString() ?? null,
      latestBytes: latestStat?.size ?? null,
      verifiedAt: verifiedStat?.mtime.toISOString() ?? null,
    };
  } catch {
    return { latestFile: null, latestAt: null, latestBytes: null, verifiedAt: null };
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const logs = await prisma.auditLog.findMany({
    where: query ? { OR: [
      { actorName: { contains: query, mode: "insensitive" } },
      { action: { contains: query, mode: "insensitive" } },
      { description: { contains: query, mode: "insensitive" } },
    ] } : undefined,
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, actorName: true, action: true, targetType: true, description: true, createdAt: true },
  });
  return NextResponse.json({ logs, backup: await backupStatus() });
}
