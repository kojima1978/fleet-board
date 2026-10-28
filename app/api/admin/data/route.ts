import { NextResponse } from "next/server";
import { z } from "zod";
import { backupCounts, createFleetBackup, FleetBackupValidationError, JSON_BACKUP_MAX_BYTES, parseFleetBackup, restoreFleetBackup } from "@/lib/json-backup";
import { consumeRateLimit, isSameOriginRequest, readJsonBody, requestClientKey } from "@/lib/request-security";
import { markDashboardDataChanged } from "@/lib/dashboard-data-version";

export const dynamic = "force-dynamic";

const restoreRequestSchema = z.object({ mode: z.enum(["validate", "restore"]), confirmation: z.string().max(20).optional(), backup: z.unknown() }).strict();

export async function GET() {
  try {
    const backup = await createFleetBackup();
    const date = backup.exportedAt.slice(0, 10).replaceAll("-", "");
    return NextResponse.json(backup, { headers: { "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="fleetflow-data-${date}.json"` } });
  } catch (error) {
    console.error("JSON backup export failed", error);
    return NextResponse.json({ message: "データを書き出せませんでした" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ message: "送信元を確認できません" }, { status: 403 });
  const rate = consumeRateLimit("json-restore", requestClientKey(request), 10, 60 * 60_000);
  if (!rate.allowed) return NextResponse.json({ message: "復元確認の回数が多すぎます。しばらく待って再試行してください" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  try {
    const body = restoreRequestSchema.parse(await readJsonBody(request, JSON_BACKUP_MAX_BYTES));
    const backup = parseFleetBackup(body.backup);
    const counts = backupCounts(backup);
    if (body.mode === "validate") return NextResponse.json({ valid: true, exportedAt: backup.exportedAt, source: backup.source, counts });
    if (body.confirmation !== "RESTORE") return NextResponse.json({ message: "確認欄へRESTOREと入力してください" }, { status: 400 });
    try {
      await restoreFleetBackup(backup);
      markDashboardDataChanged();
      return NextResponse.json({ restored: true, counts });
    } catch (error) {
      console.error("JSON backup database restore failed", error);
      return NextResponse.json({ message: "データベースへ復元できませんでした。元のデータは変更されていません" }, { status: 500 });
    }
  } catch (error) {
    if (error instanceof Error && error.message === "REQUEST_TOO_LARGE") return NextResponse.json({ message: "JSONファイルが50MBを超えています" }, { status: 413 });
    if (error instanceof Error && error.message === "INVALID_JSON") return NextResponse.json({ message: "JSONファイルを読み取れませんでした" }, { status: 400 });
    if (error instanceof z.ZodError) return NextResponse.json({ message: "復元リクエストの形式が正しくありません" }, { status: 400 });
    if (error instanceof FleetBackupValidationError) return NextResponse.json({ message: error.message }, { status: 400 });
    console.error("JSON backup request failed", error);
    return NextResponse.json({ message: "復元データを確認できませんでした" }, { status: 400 });
  }
}
