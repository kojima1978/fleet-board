export const DASHBOARD_RANGE_DAYS = [1, 3, 7, 30, 90] as const;

export type DashboardRangeDays = (typeof DASHBOARD_RANGE_DAYS)[number];

export function parseDashboardRangeDays(value: string | null, fallback: DashboardRangeDays = 3): DashboardRangeDays {
  const days = Number(value);
  return DASHBOARD_RANGE_DAYS.includes(days as DashboardRangeDays) ? days as DashboardRangeDays : fallback;
}
