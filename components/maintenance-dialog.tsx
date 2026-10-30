"use client";

import { useEffect, useState } from "react";
import { CalendarClock, CarFront, Check, MapPin, Wrench, X } from "lucide-react";
import type { DashboardData, Vehicle, VehicleMaintenance } from "@/lib/types";
import { needsReturnFuelReminder } from "@/lib/fuel-level";
import { formatMaintenanceTime, MAINTENANCE_KIND_LABELS, MAINTENANCE_KIND_SHORT_LABELS,MAINTENANCE_MAX_DAYS, MAINTENANCE_NOTE_MAX, MAINTENANCE_SCHEDULE_DAYS_AHEAD, type MaintenanceKind } from "@/lib/maintenance";
import { canUseSpot, formatSpotLabel, isCustomerSpot } from "@/lib/parking-spots";
import { CustomerSpotNotice } from "./customer-spot-notice";
import { FuelLevelPicker, FuelReminder } from "./fuel-controls";
import { Button, cn, DialogActions } from "./ui";

type Mutate = (body: object, success: string) => Promise<boolean>;

const field = "min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-50 disabled:cursor-not-allowed disabled:bg-slate-100";
// 車検で外出する予定の登録が多いため、車検・修理を先に置き、予定の登録を初期表示にする。
const KIND_ORDER: readonly MaintenanceKind[] = ["OFF_SITE", "ON_SITE"];
const KIND_HINTS: Record<MaintenanceKind, string> ={ ON_SITE: "駐車場に置いたまま使えない状態にします", OFF_SITE: "車両は駐車場にいません。区画は空けるので、ほかの車を停められます" };

// datetime-localは端末の時刻で入出力するため、ISO文字列との変換をここにまとめる。
const toLocalInput = (value: Date | string | null) => {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : null);
// サーバーと同じ範囲を入力欄にも付け、範囲外の日時を選べないようにする。datetime-localの値は同じ形式なので文字列のまま比べられる。
const addDays = (value: string, days: number) => toLocalInput(new Date(new Date(value).getTime() + days * 24 * 60 * 60_000));
const inRange = (value: string, min: string, max: string) => !value || (value >= min && value <= max);
const periodText = (item: Pick<VehicleMaintenance, "plannedStart" | "plannedEnd">) => `${formatMaintenanceTime(item.plannedStart)}〜${item.plannedEnd ? formatMaintenanceTime(item.plannedEnd) : "未定"}`;
const EXTENSION_OPTIONS = [{ label: "半日", hours: 12 }, { label: "1日", hours: 24 }, { label: "2日", hours: 48 }] as const;

function MaintenanceSummary({ items }: { items: { label: string; value: string }[] }) {
  return <dl aria-label="登録内容の確認" className="grid gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-2">{items.map((item) => <div key={item.label} className="min-w-0 bg-white px-3 py-2.5"><dt className="text-[10px] font-bold text-slate-500">{item.label}</dt><dd className="mt-0.5 truncate text-sm font-black text-slate-900">{item.value}</dd></div>)}</dl>;
}
// 車検・整備は車両利用ではないため社員選択を求めない。共用端末で選択中の社員は操作履歴にだけ自動記録する。
const auditActorBody = (currentEmployeeId?: string | null, fromSettings = false) => fromSettings
  ? { fromSettings: true }
  : currentEmployeeId ? { actorEmployeeId: currentEmployeeId } : {};

export const activeMaintenanceOf = (data: Pick<DashboardData, "maintenances">, vehicleId: string) => data.maintenances.find((item) => item.vehicleId === vehicleId && item.status === "ACTIVE") ?? null;

export function MaintenanceDialog({ vehicle, data, mutate, fromSettings, currentEmployeeId, initialMaintenanceId, initialSpotId = "", onChooseSpot, onClose, onDone }: { vehicle: Vehicle; data: DashboardData; mutate: Mutate; fromSettings?: boolean; currentEmployeeId?: string | null; initialMaintenanceId?: string; initialSpotId?: string; onChooseSpot?: () => void; onClose: () => void; onDone?: () => void }) {
  const active = activeMaintenanceOf(data, vehicle.id);
  const scheduled = data.maintenances.filter((item) => item.vehicleId === vehicle.id && item.status === "SCHEDULED");
  const initialScheduled = initialMaintenanceId ? scheduled.find((item) => item.id === initialMaintenanceId) ?? null : null;
  const inMaintenance = vehicle.status === "MAINTENANCE";
  const canStartNow = vehicle.status === "AVAILABLE";
  const [kind, setKind] = useState<MaintenanceKind>("OFF_SITE");
  const [timing, setTiming] = useState<"now" | "later">("later");
  const [note, setNote] = useState(active?.note ?? "");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState(toLocalInput(active?.plannedEnd ?? null));
  const [spotId, setSpotId] = useState(initialSpotId);
  const [fuelLevel, setFuelLevel] = useState(vehicle.fuelLevel);
  // 車検の日程はずれることがあるため、登録済みの予定は開始予定・戻り予定・備考を直せる。
  const [editing, setEditing] = useState<{ id: string; start: string; end: string; note: string } | null>(() => initialScheduled ? { id: initialScheduled.id, start: toLocalInput(initialScheduled.plannedStart), end: toLocalInput(initialScheduled.plannedEnd), note: initialScheduled.note ?? "" } : null);
  const [keepDuration, setKeepDuration] = useState(true);
  // 予定の取り消しは元に戻せないため、確認してから行う。
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const actorBody = auditActorBody(currentEmployeeId, fromSettings);
  const run = async (body: object, success: string) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      if (await mutate(body, success)) { onDone?.(); onClose(); }
    } finally { setSubmitting(false); }
  };
  const submitNew = () => {
    if (timing === "now") return run({ action: "startMaintenance", vehicleId: vehicle.id, version: vehicle.version, kind, note, plannedEnd: fromLocalInput(end), ...actorBody }, `${vehicle.name}を${MAINTENANCE_KIND_SHORT_LABELS[kind]}にしました`);
    return run({ action: "scheduleMaintenance", vehicleId: vehicle.id, kind, note, plannedStart: fromLocalInput(start), plannedEnd: fromLocalInput(end) }, `${vehicle.name}の整備予定を登録しました`);
  };
  const startScheduled = (item: VehicleMaintenance) => run({ action: "startMaintenance", vehicleId: vehicle.id, version: vehicle.version, kind: item.kind, note: item.note, plannedEnd: item.plannedEnd && new Date(item.plannedEnd) > new Date() ? item.plannedEnd : null, maintenanceId: item.id, ...actorBody }, `${vehicle.name}を${MAINTENANCE_KIND_SHORT_LABELS[item.kind]}にしました`);
  const finish = () => run({ action: "endMaintenance", vehicleId: vehicle.id, version: vehicle.version, ...(active?.kind === "OFF_SITE" ? { spotId, fuelLevel } : {}), ...actorBody }, active?.kind === "OFF_SITE" ? `${vehicle.name}を返却しました` : `${vehicle.name}を利用可能に戻しました`);
  const now = toLocalInput(new Date());
  const nowEndMax = addDays(now, MAINTENANCE_MAX_DAYS);
  const startMax = addDays(now, MAINTENANCE_SCHEDULE_DAYS_AHEAD);
  const laterEndMin = start && start > now ? start : now;
  const laterEndMax = addDays(laterEndMin, MAINTENANCE_MAX_DAYS);
  const freeSpots = data.spots.filter((spot) => (!spot.vehicle || spot.vehicle.id === vehicle.id) && canUseSpot(vehicle, spot));
  const selectedSpot = freeSpots.find((spot) => spot.id === spotId) ?? null;
  const newReady = timing === "now" ? canStartNow && inRange(end, now, nowEndMax) : !!start && !!end && inRange(start, now, startMax) && end > start && inRange(end, laterEndMin, laterEndMax);
  const editItem = editing ? scheduled.find((item) => item.id === editing.id) ?? null : null;
  // 開始予定を過ぎたまま始めていない予定もあるため、開始予定は動かしたときだけ今以降かを確かめて送る。
  const editStartChanged = !!editing && !!editItem && editing.start !== toLocalInput(editItem.plannedStart);
  const editReady = !!editing && !!editItem && !!editing.start && !!editing.end
    && (editStartChanged || editing.end !== toLocalInput(editItem.plannedEnd) || editing.note !== (editItem.note ?? ""))
    && (!editStartChanged || inRange(editing.start, now, startMax))
    && editing.end > editing.start && editing.end <= addDays(editing.start > now ? editing.start : now, MAINTENANCE_MAX_DAYS);
  const saveEdit = () => {
    if (!editing || !editItem) return;
    return run({ action: "updateMaintenance", maintenanceId: editItem.id, version: editItem.version, note: editing.note, plannedEnd: fromLocalInput(editing.end), ...(editStartChanged ? { plannedStart: fromLocalInput(editing.start) } : {}) }, `${vehicle.name}の整備予定を変更しました`);
  };
  const changeEditStart = (value: string) => {
    if (!editing) return;
    if (!keepDuration || !editing.start || !editing.end || !value) { setEditing({ ...editing, start: value }); return; }
    const shift = new Date(value).getTime() - new Date(editing.start).getTime();
    const shiftedEnd = new Date(new Date(editing.end).getTime() + shift);
    setEditing({ ...editing, start: value, end: toLocalInput(shiftedEnd) });
  };
  const edited = !!active && (note !== (active.note ?? "") || end !== toLocalInput(active.plannedEnd)) && inRange(end, now, nowEndMax);
  const extendEnd = (hours: number) => {
    const current = end ? new Date(end).getTime() : 0;
    setEnd(toLocalInput(new Date(Math.max(Date.now(), current) + hours * 60 * 60_000)));
  };
  const changeFuelLevel = (level: number) => {
    setFuelLevel(level);
  };

  if (initialScheduled && editing && editItem) return <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose(); }} onKeyDown={(event) => { if (event.key === "Escape" && !submitting) onClose(); }}>
    <div role="dialog" data-focus-layer aria-modal="true" aria-labelledby="maintenance-title" aria-busy={submitting} className="relative max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-3xl bg-white shadow-2xl">
      <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-100 bg-white p-5"><div><h2 id="maintenance-title" className="text-lg font-black">車検・整備予定を変更</h2><p className="mt-1 text-xs text-slate-500">{vehicle.name} ・ {vehicle.code}</p></div><button type="button" aria-label="閉じる" disabled={submitting} onClick={onClose} className="grid size-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-40"><X className="size-4" /></button></div>
      <div className="space-y-5 p-5">
        <MaintenanceSummary items={[{ label: "状態", value: "車検・整備予定" }, { label: "車両", value: `${vehicle.code}・${vehicle.name}` }, { label: "開始予定", value: formatMaintenanceTime(editItem.plannedStart) }, { label: "現在の戻り予定", value: editItem.plannedEnd ? formatMaintenanceTime(editItem.plannedEnd) : "未定" }]} />
        <fieldset disabled={submitting} className="space-y-3">
          <label className="block"><span className="mb-1 block text-xs font-bold text-slate-600">開始予定</span><input type="datetime-local" className={field} min={now} max={startMax} value={editing.start} onChange={(event) => changeEditStart(event.target.value)} /></label>
          <label className="block"><span className="mb-1 block text-xs font-bold text-slate-600">戻り予定</span><input type="datetime-local" className={field} min={editing.start} max={addDays(editing.start > now ? editing.start : now, MAINTENANCE_MAX_DAYS)} value={editing.end} onChange={(event) => setEditing({ ...editing, end: event.target.value })} /><span className="mt-1 block text-[11px] text-slate-500">この期間は車両を予約できません</span></label>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-bold text-slate-700"><input type="checkbox" className="size-4 accent-blue-600" checked={keepDuration} onChange={(event) => setKeepDuration(event.target.checked)} />開始を変えたら戻り予定も動かす</label>
          <label className="block"><span className="mb-1 block text-xs font-bold text-slate-600">備考（任意）</span><input className={field} maxLength={MAINTENANCE_NOTE_MAX} value={editing.note} onChange={(event) => setEditing({ ...editing, note: event.target.value })} placeholder="例：〇〇整備工場、タイヤ交換" /></label>
        </fieldset>
        <div className="border-t border-slate-100 pt-4">{confirmCancelId === editItem.id ? <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4"><p className="text-sm font-bold text-rose-800">この車検・整備予定を取り消しますか？</p><div className="mt-3 grid grid-cols-2 gap-2"><Button variant="ghost" disabled={submitting} onClick={() => setConfirmCancelId(null)}>戻る</Button><Button variant="danger" disabled={submitting} onClick={() => void run({ action: "cancelMaintenance", maintenanceId: editItem.id, version: editItem.version }, "整備予定を取り消しました")}>予定を取り消す</Button></div></div> : <button type="button" disabled={submitting} className="mx-auto flex min-h-10 items-center rounded-lg px-3 text-sm font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-40" onClick={() => setConfirmCancelId(editItem.id)}>この予定を取り消す</button>}</div>
      </div>
      <div className="sticky bottom-0 border-t border-slate-200 bg-white p-4"><DialogActions cancelDisabled={submitting} onCancel={onClose}><Button className="min-h-12" disabled={!editReady || submitting} onClick={() => void saveEdit()}>{submitting ? "保存中…" : "変更を保存"}</Button></DialogActions></div>
    </div>
  </div>;

  return <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm" onKeyDown={(event) => { if (event.key === "Escape" && !submitting) onClose(); }}>
    <div role="dialog" data-focus-layer aria-modal="true" aria-labelledby="maintenance-title" aria-busy={submitting} className="relative max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl">
      <button type="button" aria-label="閉じる" disabled={submitting} onClick={onClose} className="absolute right-4 top-4 grid size-9 place-items-center rounded-full text-slate-500 hover:bg-slate-100"><X className="size-4" /></button>
      <div className="flex items-center gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700"><Wrench className="size-5" /></span><div><h2 id="maintenance-title" className="text-lg font-black">{inMaintenance ? "車検・整備の状況" : "車検・整備を登録"}</h2><p className="text-xs text-slate-500">{vehicle.code} ・ {vehicle.name} ・ {vehicle.plateNumber}</p></div></div>
      {inMaintenance ? <div className="mt-5 space-y-4">
        <MaintenanceSummary items={active ? [{ label: "状態", value: MAINTENANCE_KIND_LABELS[active.kind] }, { label: "車両", value: `${vehicle.code}・${vehicle.name}` }, { label: "開始", value: formatMaintenanceTime(active.actualStart ?? active.plannedStart) }, { label: "戻り予定", value: active.plannedEnd ? formatMaintenanceTime(active.plannedEnd) : "未定" }] : [{ label: "状態", value: "整備中" }, { label: "車両", value: `${vehicle.code}・${vehicle.name}` }]} />
        {active?.note ? <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600"><span className="mr-2 font-bold text-slate-500">備考</span>{active.note}</p> : null}
        {active?.kind === "OFF_SITE" ? <fieldset disabled={submitting} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <legend className="px-1 text-sm font-black text-slate-800">車検終了・返却</legend>
          <div className={cn("flex items-center gap-2 rounded-xl border px-3 py-2", selectedSpot ? "border-slate-200 bg-slate-50" : "border-amber-200 bg-amber-50 text-amber-800")}><MapPin className="size-4 shrink-0" /><p className="mr-auto text-sm font-black"><span className="mr-2 text-xs font-bold opacity-70">返却先</span>{selectedSpot ? formatSpotLabel(selectedSpot) : "未選択"}</p>{selectedSpot && onChooseSpot ? <Button variant="ghost" className="min-h-9 shrink-0 px-3 text-xs" onClick={onChooseSpot}>変更</Button> : null}</div>
          {onChooseSpot ? !selectedSpot ? <Button className="min-h-12 w-full" onClick={onChooseSpot}><MapPin className="size-4" />配置図で返却先を選ぶ</Button> : null : <label className="block"><span className="mb-1 block text-xs font-bold text-slate-600">返却先を選択</span><select className={field} value={spotId} onChange={(event) => setSpotId(event.target.value)}><option value="">選んでください</option>{freeSpots.map((spot) => <option key={spot.id} value={spot.id}>{formatSpotLabel(spot)}</option>)}</select></label>}
          {selectedSpot && isCustomerSpot(selectedSpot) ? <CustomerSpotNotice spots={data.spots} vehicle={vehicle} /> : null}
          {selectedSpot ? <><FuelLevelPicker value={fuelLevel} onChange={changeFuelLevel} />
            {needsReturnFuelReminder(fuelLevel) ? <FuelReminder key={fuelLevel} context="return" attention /> : null}
            <Button className="min-h-12 w-full" disabled={submitting} onClick={() => void finish()}><Check className="size-4" />{submitting ? "返却登録中…" : `${formatSpotLabel(selectedSpot)}へ返却する`}</Button>
            <p className="text-center text-[11px] text-slate-500">このボタンを押すまで返却は確定しません。</p></> : <p className="text-[11px] leading-5 text-slate-500">返却先は配置図をタップ、または車検中の車を空き区画へドラッグして選べます。</p>}
        </fieldset> : null}
        {active ? <fieldset disabled={submitting} className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/50 p-4">
          <legend className="px-1 text-sm font-black text-slate-700">戻り予定を延長</legend>
          <div className="grid grid-cols-3 gap-2">{EXTENSION_OPTIONS.map((option) => <button key={option.hours} type="button" onClick={() => extendEnd(option.hours)} className="min-h-11 rounded-xl border border-slate-200 bg-white text-xs font-black text-slate-700 hover:border-blue-300 hover:bg-blue-50">{option.label}延長</button>)}</div>
          <label className="block"><span className="mb-1 block text-xs font-bold text-slate-600">戻り予定（日時指定）</span><input type="datetime-local" className={field} min={now} max={nowEndMax} value={end} onChange={(event) => setEnd(event.target.value)} /><span className="mt-1 block text-[11px] text-slate-500">期限を過ぎている場合は、現在時刻を基準に延長します</span></label>
          <label className="block"><span className="mb-1 block text-xs font-bold text-slate-600">備考（任意）</span><input className={field} maxLength={MAINTENANCE_NOTE_MAX} value={note} onChange={(event) => setNote(event.target.value)} placeholder="例：〇〇整備工場、タイヤ交換" /></label>
          <div className="flex justify-end"><Button variant="ghost" className="min-h-10 px-4" disabled={!edited} onClick={() => run({ action: "updateMaintenance", maintenanceId: active.id, version: active.version, note, plannedEnd: fromLocalInput(end) }, `${vehicle.name}の戻り予定を変更しました`)}>延長を保存</Button></div>
        </fieldset> : null}
      </div> : <fieldset disabled={submitting} className="mt-5 space-y-4">
        <div role="radiogroup" aria-label="整備の種類" className="grid gap-2">{KIND_ORDER.map((item) => <label key={item} className={cn("flex cursor-pointer gap-3 rounded-2xl border p-3", kind === item ? "border-amber-300 bg-amber-50" : "border-slate-200")}><input type="radio" name="maintenance-kind" className="mt-1 size-4 accent-amber-600" checked={kind === item} onChange={() => setKind(item)} /><span><span className="block text-sm font-black">{MAINTENANCE_KIND_LABELS[item]}</span><span className="block text-xs text-slate-500">{KIND_HINTS[item]}</span></span></label>)}</div>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">{(["later", "now"] as const).map((item) => <button key={item} type="button" disabled={item === "now" && !canStartNow} onClick={() => setTiming(item)} className={cn("min-h-9 rounded-lg text-xs font-bold disabled:opacity-40", timing === item ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>{item === "now" ? "今すぐ" : "予定を登録"}</button>)}</div>
        {!canStartNow ? <p className="text-xs font-bold text-amber-700">利用中の車両は、返却後に整備を始められます。予定は登録できます。</p> : null}
        {timing === "later" ? <label className="block"><span className="mb-1 block text-xs font-bold text-slate-600">開始予定</span><input required type="datetime-local" className={field} min={now} max={startMax} value={start} onChange={(event) => setStart(event.target.value)} /><span className="mt-1 block text-[11px] text-slate-500">1年先まで登録できます</span></label> : null}
        <label className="block"><span className="mb-1 block text-xs font-bold text-slate-600">{timing === "now" ? "戻り予定（任意）" : "戻り予定"}</span><input required={timing === "later"} type="datetime-local" className={field} min={timing === "now" ? now : laterEndMin} max={timing === "now" ? nowEndMax : laterEndMax} value={end} onChange={(event) => setEnd(event.target.value)} />{timing === "now" ? <span className="mt-1 block text-[11px] text-slate-500">今から{MAINTENANCE_MAX_DAYS}日以内。決まっていれば、その後の時間を予約できます</span> : <span className="mt-1 block text-[11px] text-slate-500">開始から{MAINTENANCE_MAX_DAYS}日以内。この期間は予約できなくなります</span>}</label>
        <label className="block"><span className="mb-1 block text-xs font-bold text-slate-600">備考（任意）</span><input className={field} maxLength={MAINTENANCE_NOTE_MAX} value={note} onChange={(event) => setNote(event.target.value)} placeholder="例：〇〇整備工場、タイヤ交換" /></label>
      </fieldset>}

      {scheduled.length ? <div className="mt-5 space-y-2"><p className="flex items-center gap-1.5 text-xs font-black text-slate-600"><CalendarClock className="size-3.5" />登録済みの整備予定</p>{scheduled.map((item) => editing?.id === item.id ? <fieldset key={item.id} disabled={submitting} className="space-y-3 rounded-xl border border-amber-300 bg-amber-50/40 p-3">
        <legend className="px-1 text-xs font-black text-amber-800">{MAINTENANCE_KIND_SHORT_LABELS[item.kind]}の予定を変更</legend>
        <label className="block"><span className="mb-1 block text-xs font-bold text-slate-600">開始予定</span><input type="datetime-local" className={field} min={now} max={startMax} value={editing.start} onChange={(event) => setEditing({ ...editing, start: event.target.value })} /></label>
        <label className="block"><span className="mb-1 block text-xs font-bold text-slate-600">戻り予定</span><input type="datetime-local" className={field} min={editing.start} max={addDays(editing.start > now ? editing.start : now, MAINTENANCE_MAX_DAYS)} value={editing.end} onChange={(event) => setEditing({ ...editing, end: event.target.value })} /><span className="mt-1 block text-[11px] text-slate-500">開始から{MAINTENANCE_MAX_DAYS}日以内。この期間は予約できなくなります</span></label>
        <label className="block"><span className="mb-1 block text-xs font-bold text-slate-600">備考（任意）</span><input className={field} maxLength={MAINTENANCE_NOTE_MAX} value={editing.note} onChange={(event) => setEditing({ ...editing, note: event.target.value })} placeholder="例：〇〇整備工場、タイヤ交換" /></label>
        <div className="grid grid-cols-2 gap-2"><Button variant="ghost" onClick={() => setEditing(null)}>キャンセル</Button><Button disabled={!editReady} onClick={() => void saveEdit()}>{submitting ? "処理中…" : "変更を保存"}</Button></div>
      </fieldset> : <div key={item.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 p-3"><div className="mr-auto min-w-0"><p className="text-sm font-bold">{periodText(item)}</p><p className="text-xs text-slate-500">{MAINTENANCE_KIND_SHORT_LABELS[item.kind]}{item.note ? ` ・ ${item.note}` : ""}</p></div>{confirmCancelId === item.id ? <div role="alert" className="flex w-full flex-wrap items-center gap-2 rounded-lg bg-rose-50 p-2"><p className="mr-auto text-xs font-bold text-rose-800">この予定を取り消しますか？</p><Button variant="ghost" className="min-h-9 px-3 text-xs" disabled={submitting} onClick={() => setConfirmCancelId(null)}>戻る</Button><Button variant="danger" className="min-h-9 px-3 text-xs" disabled={submitting} onClick={() => void run({ action: "cancelMaintenance", maintenanceId: item.id, version: item.version }, "整備予定を取り消しました")}>取り消す</Button></div> : <><button type="button" disabled={submitting || !canStartNow} onClick={() => void startScheduled(item)} className="min-h-9 rounded-lg border border-amber-200 px-3 text-xs font-bold text-amber-700 hover:bg-amber-50 disabled:opacity-40">開始</button><button type="button" disabled={submitting} onClick={() => setEditing({ id: item.id, start: toLocalInput(item.plannedStart), end: toLocalInput(item.plannedEnd), note: item.note ?? "" })} className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40">変更</button><button type="button" disabled={submitting} onClick={() => setConfirmCancelId(item.id)} className="min-h-9 rounded-lg px-2 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-40">取消</button></>}</div>)}</div> : null}
      <div className="sticky -bottom-6 z-10 -mx-6 mt-5 border-t border-slate-200 bg-white/95 px-6 pb-1 pt-3 backdrop-blur">{inMaintenance ? active?.kind === "OFF_SITE" ? <Button variant="ghost" className="min-h-11 w-full" disabled={submitting} onClick={onClose}>閉じる</Button> : <DialogActions cancelDisabled={submitting} onCancel={onClose}><Button className="min-h-12" disabled={submitting} onClick={finish}><CarFront className="size-4" />{submitting ? "処理中…" : "整備を解除"}</Button></DialogActions> : <DialogActions cancelDisabled={submitting} onCancel={onClose}><Button className="min-h-12" disabled={submitting || !newReady} onClick={() => void submitNew()}>{submitting ? "処理中…" : timing === "now" ? `${MAINTENANCE_KIND_SHORT_LABELS[kind]}にする` : "予定を登録"}</Button></DialogActions>}</div>
    </div>
  </div>;
}

// 駐車場の画面から、登録済みの予定どおり車検に出庫する（故障は整備を始める）。予定は予約を止めるためのもので、実際に出たことはこの操作で記録する。
export function SendOutDialog({ vehicle, maintenance, data, mutate, currentEmployeeId, onClose }: { vehicle: Vehicle; maintenance: VehicleMaintenance; data: DashboardData; mutate: Mutate; currentEmployeeId: string | null; onClose: () => void }) {
  const [end, setEnd] = useState(toLocalInput(maintenance.plannedEnd && new Date(maintenance.plannedEnd) > new Date() ? maintenance.plannedEnd : null));
  const [submitting, setSubmitting] = useState(false);
  const offSite = maintenance.kind === "OFF_SITE";
  const spot = data.spots.find((item) => item.id === vehicle.parkingSpotId);
  const now = toLocalInput(new Date());
  const nowEndMax = addDays(now, MAINTENANCE_MAX_DAYS);
  const canStartNow = vehicle.status === "AVAILABLE";
  const ready = canStartNow && inRange(end, now, nowEndMax);
  const actionLabel = offSite ? "出庫する" : "整備中にする";
  const submit = async () => {
    if (submitting || !ready) return;
    setSubmitting(true);
    try {
      if (await mutate({ action: "startMaintenance", vehicleId: vehicle.id, version: vehicle.version, kind: maintenance.kind, note: maintenance.note, plannedEnd: fromLocalInput(end), maintenanceId: maintenance.id, ...auditActorBody(currentEmployeeId) }, offSite ? `${vehicle.name}を車検に出庫しました` : `${vehicle.name}を${MAINTENANCE_KIND_SHORT_LABELS[maintenance.kind]}にしました`)) onClose();
    } finally { setSubmitting(false); }
  };
  return <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm" onKeyDown={(event) => { if (event.key === "Escape" && !submitting) onClose(); }}>
    <div role="dialog" data-focus-layer aria-modal="true" aria-labelledby="send-out-title" aria-busy={submitting} className="relative max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl">
      <button type="button" aria-label="閉じる" disabled={submitting} onClick={onClose} className="absolute right-4 top-4 grid size-9 place-items-center rounded-full text-slate-500 hover:bg-slate-100"><X className="size-4" /></button>
      <div className="flex items-center gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-700"><Wrench className="size-5" /></span><div><h2 id="send-out-title" className="text-lg font-black">{vehicle.name}を{actionLabel}</h2><p className="text-xs text-slate-500">{vehicle.plateNumber} ・ {vehicle.code}</p></div></div>
      <fieldset disabled={submitting} className="mt-5 space-y-4">
        <div className="rounded-2xl bg-amber-50 p-4 text-sm"><p className="font-black text-amber-900">{MAINTENANCE_KIND_LABELS[maintenance.kind]}</p><p className="mt-1 text-xs font-bold text-amber-800">予定 {periodText(maintenance)}</p>{maintenance.note ? <p className="mt-1 text-xs text-amber-900">{maintenance.note}</p> : null}<p className="mt-2 text-xs text-amber-800">{offSite ? `${spot ? `${formatSpotLabel(spot)}を空けます。` : ""}戻るまで、ほかの車を停められます。` : "区画に置いたまま、使えない状態にします。"}</p></div>
        <label className="block"><span className="mb-1 block text-xs font-bold text-slate-600">戻り予定（未定なら空欄）</span><input type="datetime-local" className={field} min={now} max={nowEndMax} value={end} onChange={(event) => setEnd(event.target.value)} /><span className="mt-1 block text-[11px] text-slate-500">日程がずれたときは、ここで直せます</span></label>
        {!canStartNow ? <p className="text-xs font-bold text-amber-700">利用中の車両は、返却してから出庫できます。</p> : null}
      </fieldset>
      <div className="sticky -bottom-6 z-10 -mx-6 mt-5 border-t border-slate-200 bg-white/95 px-6 pb-1 pt-3 backdrop-blur"><DialogActions cancelDisabled={submitting} onCancel={onClose}><Button className="min-h-12" disabled={submitting || !ready} onClick={() => void submit()}><Wrench className="size-4" />{submitting ? "処理中…" : actionLabel}</Button></DialogActions></div>
    </div>
  </div>;
}
