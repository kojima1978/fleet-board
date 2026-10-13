import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getBackupStatus } from "@/lib/backup-status";
import { getApplicationSystemStatus } from "@/lib/system-status";

export async function GET() {
  try {
    const [, backup, system] = await Promise.all([prisma.$queryRaw`SELECT 1`, getBackupStatus(), getApplicationSystemStatus()]);
    return NextResponse.json({ status: "ok", database: "ok", backup, version: system.appVersion, environment: system.environment, deployedAt: system.deployedAt, schemaVersion: system.schemaVersion, checkedAt: new Date().toISOString() });
  } catch {
    return NextResponse.json({ status: "error", database: "unavailable", version: process.env.FLEETFLOW_APP_VERSION || "development", environment: process.env.NODE_ENV || "development", deployedAt: process.env.FLEETFLOW_DEPLOYED_AT || null, checkedAt: new Date().toISOString() }, { status: 503 });
  }
}
