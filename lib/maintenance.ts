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
const DAY = 24 * 60 * 60_000;
const TOKYO_OFFSET = 9 * 60 * 60_000;
// 東京時間で、今日からdays日後の日の終わり（翌日0時）。
const tokyoDayEnd = (now: number, days = 0) => Math.floor((now + TOKYO_OFFSET) / DAY) * DAY + (days + 1) * DAY - TOKYO_OFFSET;
const isTokyoToday = (value: string, now: number) => { const time = Date.parse(value); return time >= tokyoDayEnd(now, -1) && time < tokyoDayEnd(now); };
const tokyoTime = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false });
const tokyoDate = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" });

// 駐車場の画面に出す整備予定は、開始予定日の前日から。
export const UPCOMING_MAINTENANCE_DAYS_BEFORE = 1;
export const UPCOMING_MAINTENANCE_LIMIT = 3;

// まだ始めていない整備予定のうち、開始予定日の前日になったものを開始予定の近い順に返す。開始予定を過ぎても始めていない予定も含める。
export function getUpcomingMaintenances<T extends { status: string; plannedStart: string }>(maintenances: readonly T[], now: number, daysBefore = UPCOMING_MAINTENANCE_DAYS_BEFORE) {
  const until = tokyoDayEnd(now, daysBefore);
  return maintenances.filter((item) => item.status === "SCHEDULED" && Date.parse(item.plannedStart) < until).sort((a, b) => a.plannedStart.localeCompare(b.plannedStart));
}

// 駐車場の画面から出庫できる予定。日程がずれることがあるため、今日（東京時間）中に始まる予定と、開始予定を過ぎた予定にする。
export function canSendOutMaintenance(item: { status: string; plannedStart: string }, now: number) {
  return item.status === "SCHEDULED" && Date.parse(item.plannedStart) < tokyoDayEnd(now);
}

// 予定の開始の表示。今日なら時刻だけ、ほかの日は日付も付ける（配置図の札は日付だけ）。
export const formatMaintenanceStart = (value: string, now: number) => isTokyoToday(value, now) ? tokyoTime.format(new Date(value)) : formatMaintenanceTime(value);
export const formatMaintenanceBadge = (value: string, now: number) => isTokyoToday(value, now) ? tokyoTime.format(new Date(value)) : tokyoDate.format(new Date(value));

type MaintenancePeriod = { kind: MaintenanceKind; status: string; plannedStart: Date | string; plannedEnd: Date | string | null };

// 予約や延長が整備の期間と重なったときに返す文言。
export function maintenanceConflictMessage(maintenance: MaintenancePeriod) {
  const label = MAINTENANCE_KIND_SHORT_LABELS[maintenance.kind];
  const until = maintenance.plannedEnd ? formatMaintenanceTime(maintenance.plannedEnd) : "未定";
  return maintenance.status === "ACTIVE"
    ? `${label}のため使えない期間（戻り予定 ${until}）と重なっています`
    : `${formatMaintenanceTime(maintenance.plannedStart)}〜${until}の整備予定（${label}）と重なっています`;
}
