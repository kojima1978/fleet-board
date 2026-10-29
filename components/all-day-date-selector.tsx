"use client";
import { allDayDates, allDayStart } from "@/lib/all-day-reservation";

export function AllDayDateSelector({ value, now, onChange }: { value: string; now: Date; onChange: (value: string) => void }) {
  const dates = allDayDates(now);
  return <div className="space-y-2">
    <div role="group" aria-label="1日利用の開始日" className="grid grid-cols-2 gap-2">{dates.choices.map((day) => <button type="button" key={day.date} aria-pressed={value === day.date} onClick={() => onChange(day.date)} className={`min-h-12 rounded-xl border px-2 text-xs font-bold ${value === day.date ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-blue-50"}`}>{day.label}</button>)}</div>
    <p className="text-xs text-slate-500">6:00〜22:00の利用です。予約できるのは7日後までです。</p>
    {!allDayStart(value, now) ? <p role="alert" className="text-xs font-bold text-rose-700">開始が現在より後になる日付を、予約可能な範囲で選んでください。</p> : null}
  </div>;
}
