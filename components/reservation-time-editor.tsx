"use client";

import { useState } from "react";
import { validateReservationStart } from "@/lib/trip-times";
import { Button, DialogActions } from "./ui";

const localInput = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const display = (value: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
type Period = { plannedStart: string; plannedEnd: string };

// 入力欄と確定ボタンを分けて置けるよう、予約時間の入力状態をまとめる。確定ボタンは予約を変更の画面では下の操作欄に置く。
export function useReservationTimeEdit(trip: Period) {
  const [start, setStart] = useState(() => localInput(new Date(trip.plannedStart)));
  const [end, setEndValue] = useState(() => localInput(new Date(trip.plannedEnd)));
  const [keepDuration, setKeepDurationValue] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const changed = start !== localInput(new Date(trip.plannedStart)) || end !== localInput(new Date(trip.plannedEnd));
  let message = "";
  try { validateReservationStart(new Date(start), new Date(end), new Date()); } catch (error) { message = (error as Error).message; }
  const shift = (minutes: number) => {
    setStart(localInput(new Date(new Date(start).getTime() + minutes * 60_000)));
    setEndValue(localInput(new Date(new Date(end).getTime() + minutes * 60_000)));
    setConfirm(false);
  };
  const changeStart = (value: string) => {
    if (keepDuration && Number.isFinite(new Date(value).getTime()) && Number.isFinite(new Date(start).getTime()) && Number.isFinite(new Date(end).getTime())) {
      setEndValue(localInput(new Date(new Date(end).getTime() + new Date(value).getTime() - new Date(start).getTime())));
    }
    setStart(value); setConfirm(false);
  };
  const setEnd = (value: string) => { setEndValue(value); setConfirm(false); };
  const setKeepDuration = (value: boolean) => { setKeepDurationValue(value); setConfirm(false); };
  return { trip, start, end, keepDuration, confirm, changed, message, ready: changed && !message, setConfirm, shift, changeStart, setEnd, setKeepDuration };
}
export type ReservationTimeEdit = ReturnType<typeof useReservationTimeEdit>;

export function ReservationTimeFields({ edit, busy }: { edit: ReservationTimeEdit; busy: boolean }) {
  const { trip, start, end, keepDuration, confirm, changed, message } = edit;
  return <section data-kiosk-auto-home-blocked={changed || confirm || busy} className="space-y-4 rounded-2xl border border-violet-200 bg-violet-50/50 p-4">
    <div><h3 className="text-sm font-black text-slate-900">予約の日時</h3><p className="mt-1 text-xs text-slate-600">日時を指定するか、予約全体を前後に移動してください。確認後に保存します。</p></div>
    <fieldset disabled={busy || confirm} className="space-y-3 disabled:opacity-60">
      <div className="grid gap-3 sm:grid-cols-2">{([['予約の開始日時', start, edit.changeStart], ['予約の終了日時', end, edit.setEnd]] as const).map(([label, value, change]) => <label key={label} className="block min-w-0 text-xs font-bold text-slate-700">{label}<input aria-label={label} type="datetime-local" step={900} value={value} onInput={(event) => change(event.currentTarget.value)} className="mt-2 min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900" /></label>)}</div>
      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs font-bold text-slate-700"><input type="checkbox" checked={keepDuration} onChange={(event) => edit.setKeepDuration(event.target.checked)} className="size-4" />開始を変えたら終了も動かす（利用時間を維持）</label>
      <div><p className="mb-2 text-xs font-bold text-slate-600">予約全体を移動</p><div className="grid grid-cols-3 gap-2">{[-60, -30, -15, 15, 30, 60].map((minutes) => <button type="button" key={minutes} disabled={!Number.isFinite(new Date(start).getTime()) || !Number.isFinite(new Date(end).getTime())} onClick={() => edit.shift(minutes)} className="min-h-11 rounded-xl border border-violet-200 bg-white px-1 text-xs font-bold whitespace-nowrap text-violet-800 sm:text-sm hover:bg-violet-100 disabled:opacity-40">{minutes < 0 ? `${Math.abs(minutes)}分早める` : `${minutes}分遅らせる`}</button>)}</div></div>
    </fieldset>
    <p className="text-xs text-slate-500">開始は現在より後、利用時間は15分以上7日以内です。重複する予約・整備予定がある場合は保存できません。</p>
    {changed && message ? <p role="alert" className="text-xs font-bold text-rose-700">{message}</p> : null}
    {confirm && changed && !message ? <div role="status" className="space-y-3 rounded-xl border border-violet-200 bg-white p-3"><div className="text-xs text-slate-500">変更前<p className="mt-1 font-bold text-slate-700">{display(trip.plannedStart)} ～ {display(trip.plannedEnd)}</p></div><div className="text-xs font-bold text-violet-700">変更後<p className="mt-1 text-sm">{display(start)} ～ {display(end)}</p></div></div> : null}
  </section>;
}

// 確認前は「変更内容を確認」、確認後は「この内容で予約を変更」を右に置く。左は確認前ならキャンセル、確認後なら入力に戻る。
export function ReservationTimeActions({ edit, busy, onSave, onCancel }: { edit: ReservationTimeEdit; busy: boolean; onSave: (start: string, end: string) => Promise<boolean>; onCancel: () => void }) {
  if (edit.confirm && edit.ready) return <DialogActions cancelLabel="入力に戻る" cancelDisabled={busy} onCancel={() => edit.setConfirm(false)}><Button className="min-h-12" disabled={busy} onClick={() => void onSave(new Date(edit.start).toISOString(), new Date(edit.end).toISOString()).then((ok) => { if (!ok) edit.setConfirm(false); })}>{busy ? "保存中…" : "この内容で予約を変更"}</Button></DialogActions>;
  return <DialogActions cancelDisabled={busy} onCancel={onCancel}><Button className="min-h-12" disabled={busy || !edit.ready} onClick={() => edit.setConfirm(true)}>変更内容を確認</Button></DialogActions>;
}

export function ReservationTimeEditor({ trip, busy, onSave, onCancel = () => {} }: { trip: Period; busy: boolean; onSave: (start: string, end: string) => Promise<boolean>; onCancel?: () => void }) {
  const edit = useReservationTimeEdit(trip);
  return <div className="space-y-3"><ReservationTimeFields edit={edit} busy={busy} /><ReservationTimeActions edit={edit} busy={busy} onSave={onSave} onCancel={onCancel} /></div>;
}
