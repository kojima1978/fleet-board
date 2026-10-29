const DAY = 86_400_000;
const dateKey = (date: Date) => new Date(date.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);

export function allDayStart(date: string, now: Date): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const start = new Date(`${date}T06:00:00+09:00`);
  if (!Number.isFinite(start.getTime()) || dateKey(start) !== date || start <= now || start.getTime() > now.getTime() + 7 * DAY) return null;
  return start;
}

export function allDayDates(now: Date) {
  const today = dateKey(now);
  const first = new Date(`${today}T06:00:00+09:00`);
  if (first <= now) first.setTime(first.getTime() + DAY);
  const last = new Date(first);
  while (last.getTime() + DAY <= now.getTime() + 7 * DAY) last.setTime(last.getTime() + DAY);
  const formatter = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", weekday: "short" });
  return {
    min: dateKey(first), max: dateKey(last),
    choices: Array.from({ length: Math.round((last.getTime() - first.getTime()) / DAY) + 1 }, (_, index) => {
      const start = new Date(first.getTime() + index * DAY);
      const date = dateKey(start);
      const prefix = date === today ? "今日 " : date === dateKey(new Date(now.getTime() + DAY)) ? "明日 " : "";
      return { date, label: `${prefix}${formatter.format(start)}` };
    }),
  };
}
