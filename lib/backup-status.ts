import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const BACKUP_DIR = "/backups";
const BACKUP_STATUS_CACHE_MS = 30_000;

export type BackupStatus = { latestFile: string | null; latestAt: string | null; latestBytes: number | null; verifiedAt: string | null };
let cachedBackupStatus: { value: BackupStatus; expiresAt: number } | null = null;

export async function getBackupStatus(): Promise<BackupStatus> {
  const now = Date.now();
  if (cachedBackupStatus && cachedBackupStatus.expiresAt > now) return cachedBackupStatus.value;
  try {
    const files = (await readdir(BACKUP_DIR)).filter((name) => /^fleet-\d{8}-\d{6}\.sql\.gz$/.test(name)).sort().reverse();
    const latest = files[0];
    const [latestStat, verifiedStat] = await Promise.all([
      latest ? stat(path.join(BACKUP_DIR, latest)) : null,
      stat(path.join(BACKUP_DIR, ".last-verified")).catch(() => null),
    ]);
    const value = { latestFile: latest ?? null, latestAt: latestStat?.mtime.toISOString() ?? null, latestBytes: latestStat?.size ?? null, verifiedAt: verifiedStat?.mtime.toISOString() ?? null };
    cachedBackupStatus = { value, expiresAt: now + BACKUP_STATUS_CACHE_MS };
    return value;
  } catch {
    const value = { latestFile: null, latestAt: null, latestBytes: null, verifiedAt: null };
    // 一時的なI/O失敗は早めに再確認する。
    cachedBackupStatus = { value, expiresAt: now + 5_000 };
    return value;
  }
}
