"use client";
import { useState } from "react";
import { validateActualStart, type StartTimeRecord } from "@/lib/trip-times";
import { Button } from "./ui";

const localInput = (value: string | Date) => { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };
const display = (value: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
const inputClass = "mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900";

export function ActualStartEditor({ trip, busy, actorAvailable, onSave }: { trip: StartTimeRecord; busy: boolean; actorAvailable: boolean; onSave: (value: string, reason: string) => Promise<boolean> }) {
  const [value, setValue] = useState(() => trip.actualStart ? localInput(trip.actualStart) : "");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  if (!trip.actualStart || !["IN_USE", "COMPLETED"].includes(trip.status)) return null;
  const start = new Date(value);
  let message = "";
  try { validateActualStart({ ...trip, actualStart: new Date(trip.actualStart), actualEnd: trip.actualEnd ? new Date(trip.actualEnd) : null }, start, reason, new Date()); } catch (error) { message = (error as Error).message; }
  if (!message && value === localInput(trip.actualStart)) message = "変更後の開始時刻を指定してください";
  return <details data-kiosk-auto-home-blocked={busy || confirm || reason !== "" || value !== localInput(trip.actualStart)} className="rounded-xl border border-slate-200 p-3">
    <summary className="min-h-9 cursor-pointer text-xs font-bold text-slate-600">その他：利用開始時刻を訂正</summary>
    <p className="mt-2 text-xs text-slate-600">予約日時・返却予定・駐車位置は変更せず、実際の開始時刻だけ訂正します。変更前後・理由・操作者を履歴に残します。</p>
    <p className="mt-2 text-xs font-bold">現在の開始：{display(trip.actualStart)}</p>
    <label className="mt-2 block text-xs font-bold">正しい開始日時<input aria-label="正しい開始日時" type="datetime-local" step={60} max={localInput(trip.actualEnd && Date.parse(trip.actualEnd) < Date.now() ? trip.actualEnd : new Date())} value={value} disabled={busy} onChange={(event) => { setValue(event.target.value); setConfirm(false); }} className={inputClass} /></label>
    <label className="mt-3 block text-xs font-bold">訂正理由（必須）<textarea aria-label="訂正理由" maxLength={200} value={reason} disabled={busy} onChange={(event) => { setReason(event.target.value); setConfirm(false); }} placeholder="例：出庫操作を忘れたため" className="mt-2 min-h-20 w-full rounded-xl border border-slate-300 p-3 text-sm" /></label>
    {!actorAvailable ? <p role="alert" className="mt-2 text-xs text-amber-800">先にこの端末の利用者を選択してください。訂正する人を履歴に記録します。</p> : null}
    {reason && message ? <p role="alert" className="mt-2 text-xs text-rose-700">{message}</p> : null}
    {confirm && !message ? <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm"><p>変更前：{display(trip.actualStart)}</p><p>変更後：{display(start.toISOString())}</p><p className="whitespace-pre-wrap break-words">理由：{reason.trim()}</p><div className="mt-3 flex gap-2"><Button disabled={busy || !actorAvailable} onClick={() => void onSave(start.toISOString(), reason.trim()).then(() => setConfirm(false))}>この内容で訂正する</Button><Button variant="ghost" disabled={busy} onClick={() => setConfirm(false)}>戻る</Button></div></div> : <Button variant="secondary" className="mt-3" disabled={busy || !!message || !actorAvailable} onClick={() => setConfirm(true)}>訂正内容を確認</Button>}
  </details>;
}
