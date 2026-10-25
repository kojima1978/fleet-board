import { prisma } from "@/lib/prisma";

export type ApplicationSystemStatus = {
  appVersion: string;
  environment: string;
  deployedAt: string | null;
  schemaVersion: string;
};

const SYSTEM_STATUS_CACHE_MS = 60_000;
let cachedSystemStatus: { value: ApplicationSystemStatus; expiresAt: number } | null = null;

export async function getApplicationSystemStatus(): Promise<ApplicationSystemStatus> {
  const now = Date.now();
  if (cachedSystemStatus && cachedSystemStatus.expiresAt > now) return cachedSystemStatus.value;
  let schemaVersion = "development-db-push";
  if (process.env.NODE_ENV === "production") {
    schemaVersion = "未確認";
    try {
      const rows = await prisma.$queryRaw<Array<{ migration_name: string }>>`
        SELECT migration_name
        FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
        ORDER BY finished_at DESC
        LIMIT 1
      `;
      schemaVersion = rows[0]?.migration_name ?? schemaVersion;
    } catch {
      // Health remains available while a migration state is being repaired.
    }
  }
  const value = {
    appVersion: process.env.FLEETFLOW_APP_VERSION || "development",
    environment: process.env.NODE_ENV || "development",
    deployedAt: process.env.FLEETFLOW_DEPLOYED_AT || null,
    schemaVersion,
  };
  cachedSystemStatus = { value, expiresAt: now + SYSTEM_STATUS_CACHE_MS };
  return value;
}
