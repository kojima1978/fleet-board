"use client";

import { useState } from "react";
import { validateReservationStart } from "@/lib/trip-times";
import { Button } from "./ui";

const localInput = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const display = (value: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
type Period = { plannedStart: string; plannedEnd: string };

export function ReservationTimeEditor({ trip, busy, onSave }: { trip: Period; busy: boolean; onSave: (start: string, end: string) => Promise<boolean> }) {
  const [start, setStart] = useState(() => localInput(new Date(trip.plannedStart)));
  const [end, setEnd] = useState(() => localInput(new Date(trip.plannedEnd)));
  const [keepDuration, setKeepDuration] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const changed = start !== localInput(new Date(trip.plannedStart)) || end !== localInput(new Date(trip.plannedEnd));
  let message = "";
  try { validateReservationStart(new Date(start), new Date(end), new Date()); } catch (error) { message = (error as Error).message; }
  const shift = (minutes: number) => {
    setStart(localInput(new Date(new Date(start).getTime() + minutes * 60_000)));
    setEnd(localInput(new Date(new Date(end).getTime() + minutes * 60_000)));
    setConfirm(false);
  };
  const changeStart = (value: string) => {
    if (keepDuration && Number.isFinite(new Date(value).getTime()) && Number.isFinite(new Date(start).getTime()) && Number.isFinite(new Date(end).getTime())) {
      setEnd(localInput(new Date(new Date(end).getTime() + new Date(value).getTime() - new Date(start).getTime())));
    }
    setStart(value); setConfirm(false);
  };
  return <section data-kiosk-auto-home-blocked={changed || confirm || busy} className="space-y-4 rounded-2xl border border-violet-200 bg-violet-50/50 p-4">
    <div><h3 className="text-sm font-black text-slate-900">予約時間を変更</h3><p className="mt-1 text-xs text-slate-600">日時を指定するか、予約全体を前後に移動してください。確認後に保存します。</p></div>
    <fieldset disabled={busy} className="space-y-3 disabled:opacity-60">
      <div className="grid gap-3 sm:grid-cols-2">{([['予約の開始日時', start, changeStart], ['予約の終了日時', end, (value: string) => { setEnd(value); setConfirm(false); }]] as const).map(([label, value, change]) => <label key={label} className="block min-w-0 text-xs font-bold text-slate-700">{label}<input aria-label={label} type="datetime-local" step={900} value={value} onInput={(event) => change(event.currentTarget.value)} className="mt-2 min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900" /></label>)}</div>
      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs font-bold text-slate-700"><input type="checkbox" checked={keepDuration} onChange={(event) => { setKeepDuration(event.target.checked); setConfirm(false); }} className="size-4" />開始を変えたら終了も動かす（利用時間を維持）</label>
      <div><p className="mb-2 text-xs font-bold text-slate-600">予約全体を移動</p><div className="grid grid-cols-3 gap-2">{[-60, -30, -15, 15, 30, 60].map((minutes) => <button type="button" key={minutes} disabled={!Number.isFinite(new Date(start).getTime()) || !Number.isFinite(new Date(end).getTime())} onClick={() => shift(minutes)} className="min-h-11 rounded-xl border border-violet-200 bg-white px-1 text-xs font-bold whitespace-nowrap text-violet-800 sm:text-sm hover:bg-violet-100 disabled:opacity-40">{minutes < 0 ? `${Math.abs(minutes)}分早める` : `${minutes}分遅らせる`}</button>)}</div></div>
    </fieldset>
    <p className="text-xs text-slate-500">開始は現在より後、利用時間は15分以上7日以内です。重複する予約・整備予定がある場合は保存できません。</p>
    {changed && message ? <p role="alert" className="text-xs font-bold text-rose-700">{message}</p> : null}
    {confirm && changed && !message ? <div className="space-y-3 rounded-xl border border-violet-200 bg-white p-3"><div className="text-xs text-slate-500">変更前<p className="mt-1 font-bold text-slate-700">{display(trip.plannedStart)} ～ {display(trip.plannedEnd)}</p></div><div className="text-xs font-bold text-violet-700">変更後<p className="mt-1 text-sm">{display(start)} ～ {display(end)}</p></div><div className="flex gap-2"><Button variant="ghost" disabled={busy} onClick={() => setConfirm(false)}>入力に戻る</Button><Button disabled={busy} onClick={() => void onSave(new Date(start).toISOString(), new Date(end).toISOString()).then((ok) => { if (!ok) setConfirm(false); })}>{busy ? "保存中…" : "この内容で予約を変更"}</Button></div></div> : <Button className="min-h-12 w-full" disabled={busy || !changed || !!message} onClick={() => setConfirm(true)}>変更内容を確認</Button>}
  </section>;
}
