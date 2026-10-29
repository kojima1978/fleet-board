export const MAINTENANCE_KINDS = ["ON_SITE", "OFF_SITE"] as const;
export type MaintenanceKind = (typeof MAINTENANCE_KINDS)[number];

// ON_SITEは駐車場内に置いたまま使えない状態、OFF_SITEは車検場や工場へ出ていて駐車場にいない状態。
export const MAINTENANCE_KIND_LABELS: Record<MaintenanceKind, string> = { ON_SITE: "故障（駐車場内）", OFF_SITE: "車検・修理で外出" };
export const MAINTENANCE_KIND_SHORT_LABELS: Record<MaintenanceKind, string> = { ON_SITE: "整備中", OFF_SITE: "車検で外出" };

export const MAINTENANCE_NOTE_MAX = 200;
// 整備予定として登録できる範囲。車検の予約は数か月先に決まるため、利用予約より先まで登録できる。
export const MAINTENANCE_SCHEDULE_DAYS_AHEAD = 366;
export const MAINTENANCE_MAX_DAYS = 90;

const tokyoDateTime = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
export const formatMaintenanceTime = (value: Date | string) => tokyoDateTime.format(new Date(value));

// 駐車場の右の列に出す整備予定の範囲と件数。
export const UPCOMING_MAINTENANCE_DAYS = 7;
export const UPCOMING_MAINTENANCE_LIMIT = 3;

// まだ始めていない整備予定のうち、指定日数以内に始まるものを開始予定の近い順に返す。開始予定を過ぎても始めていない予定も含める。
export function getUpcomingMaintenances<T extends { status: string; plannedStart: string }>(maintenances: readonly T[], now: number, days = UPCOMING_MAINTENANCE_DAYS) {
  const until = now + days * 24 * 60 * 60_000;
  return maintenances.filter((item) => item.status === "SCHEDULED" && Date.parse(item.plannedStart) <= until).sort((a, b) => a.plannedStart.localeCompare(b.plannedStart));
}

// 駐車場の画面から「出す」を押せる予定。日程がずれることがあるため、今日（東京時間）中に始まる予定と、開始予定を過ぎた予定にする。
export function canSendOutMaintenance(item: { status: string; plannedStart: string }, now: number) {
  const day = 24 * 60 * 60_000;
  const tokyoOffset = 9 * 60 * 60_000;
  const todayEnd = Math.floor((now + tokyoOffset) / day) * day + day - tokyoOffset;
  return item.status === "SCHEDULED" && Date.parse(item.plannedStart) < todayEnd;
}

type MaintenancePeriod = { kind: MaintenanceKind; status: string; plannedStart: Date | string; plannedEnd: Date | string | null };

// 予約や延長が整備の期間と重なったときに返す文言。
export function maintenanceConflictMessage(maintenance: MaintenancePeriod) {
  const label = MAINTENANCE_KIND_SHORT_LABELS[maintenance.kind];
  const until = maintenance.plannedEnd ? formatMaintenanceTime(maintenance.plannedEnd) : "未定";
  return maintenance.status === "ACTIVE"
    ? `${label}のため使えない期間（戻り予定 ${until}）と重なっています`
    : `${formatMaintenanceTime(maintenance.plannedStart)}〜${until}の整備予定（${label}）と重なっています`;
}
