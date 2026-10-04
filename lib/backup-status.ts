import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const BACKUP_DIR = "/backups";

export type BackupStatus = { latestFile: string | null; latestAt: string | null; latestBytes: number | null; verifiedAt: string | null };

export async function getBackupStatus(): Promise<BackupStatus> {
  try {
    const files = (await readdir(BACKUP_DIR)).filter((name) => /^fleet-\d{8}-\d{6}\.sql\.gz$/.test(name)).sort().reverse();
    const latest = files[0];
    const [latestStat, verifiedStat] = await Promise.all([
      latest ? stat(path.join(BACKUP_DIR, latest)) : null,
      stat(path.join(BACKUP_DIR, ".last-verified")).catch(() => null),
    ]);
    return { latestFile: latest ?? null, latestAt: latestStat?.mtime.toISOString() ?? null, latestBytes: latestStat?.size ?? null, verifiedAt: verifiedStat?.mtime.toISOString() ?? null };
  } catch {
    return { latestFile: null, latestAt: null, latestBytes: null, verifiedAt: null };
  }
}
