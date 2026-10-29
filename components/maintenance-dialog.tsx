"use client";

import { useState } from "react";
import { CalendarClock, CarFront, Wrench, X } from "lucide-react";
import type { DashboardData, Employee, Vehicle, VehicleMaintenance } from "@/lib/types";
import { formatMaintenanceTime, MAINTENANCE_KIND_LABELS, MAINTENANCE_KIND_SHORT_LABELS,MAINTENANCE_MAX_DAYS, MAINTENANCE_NOTE_MAX, MAINTENANCE_SCHEDULE_DAYS_AHEAD, type MaintenanceKind } from "@/lib/maintenance";
import { canUseSpot, formatSpotLabel } from "@/lib/parking-spots";
import { Button, cn } from "./ui";

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

// 駐車場の画面で車検・整備に出す人、戻した人を選ぶ。最初は画面上部で選んでいる社員にする。
function ActorSelect({ label, hint, employees, value, onChange }: { label: string; hint?: string; employees: Employee[]; value: string; onChange: (value: string) => void }) {
  return <label className="block"><span className="mb-1 block text-xs font-bold text-slate-600">{label}</span><select aria-label={label} className={field} value={value} onChange={(event) => onChange(event.target.value)}>
    <option value="">選んでください</option>
    {employees.map((person) => <option key={person.id} value={person.id}>{person.code}　{person.name}</option>)}
  </select>{hint ? <span className="mt-1 block text-[11px] text-slate-500">{hint}</span> : null}</label>;
}
const activeEmployeesOf = (data: Pick<DashboardData, "employees">) => data.employees.filter((person) => person.active);
const initialActor = (employees: Employee[], currentEmployeeId?: string | null) => employees.some((person) => person.id === currentEmployeeId) ? currentEmployeeId ?? "" : "";

export const activeMaintenanceOf = (data: Pick<DashboardData, "maintenances">, vehicleId: string) => data.maintenances.find((item) => item.vehicleId === vehicleId && item.status === "ACTIVE") ?? null;

// 整備中の車両を戻す区画の選択肢。空欄は今の区画のまま（車検・修理で外出した車両は区画を空けているので位置未設定）を表す。
export function ReturnSpotSelect({ vehicle, data, value, onChange, disabled }: { vehicle: Vehicle; data: Pick<DashboardData, "spots">; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const current = data.spots.find((spot) => spot.id === vehicle.parkingSpotId);
  const others = data.spots.filter((spot) => spot.id !== vehicle.parkingSpotId && spot.enabled && !spot.vehicle && canUseSpot(vehicle, spot));
  return <select aria-label={`${vehicle.name}を戻す駐車区画`} disabled={disabled} className={field} value={value} onChange={(event) => onChange(event.target.value)}>
    <option value="">{current ? `元の区画（${formatSpotLabel(current)}）` : "駐車位置は後で設定"}</option>
    {others.map((spot) => <option key={spot.id} value={spot.id}>{formatSpotLabel(spot)}</option>)}
  </select>;
}

export function MaintenanceDialog({ vehicle, data, mutate, fromSettings, currentEmployeeId, onClose, onDone }: { vehicle: Vehicle; data: DashboardData; mutate: Mutate; fromSettings?: boolean; currentEmployeeId?: string | null; onClose: () => void; onDone?: () => void }) {
  const active = activeMaintenanceOf(data, vehicle.id);
  const scheduled = data.maintenances.filter((item) => item.vehicleId === vehicle.id && item.status === "SCHEDULED");
  const inMaintenance = vehicle.status === "MAINTENANCE";
  const canStartNow = vehicle.status === "AVAILABLE";
  const [kind, setKind] = useState<MaintenanceKind>("OFF_SITE");
  const [timing, setTiming] = useState<"now" | "later">("later");
  const [note, setNote] = useState(active?.note ?? "");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState(toLocalInput(active?.plannedEnd ?? null));
  const [spotId, setSpotId] = useState("");
  // 車検の日程はずれることがあるため、登録済みの予定は開始予定・戻り予定・備考を直せる。
  const [editing, setEditing] = useState<{ id: string; start: string; end: string; note: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 駐車場の画面では、開始・戻ったを押した社員を履歴に残す。設定画面からの操作は「設定画面」として残す。
  const employees = activeEmployeesOf(data);
  const [actorId, setActorId] = useState(() => initialActor(employees, currentEmployeeId));
  const actorBody = fromSettings ? { fromSettings: true } : { actorEmployeeId: actorId };
  const actorReady = !!fromSettings || !!actorId;
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
  const finish = () => run({ action: "endMaintenance", vehicleId: vehicle.id, version: vehicle.version, ...(spotId ? { spotId } : {}), ...actorBody }, active?.kind === "OFF_SITE" ? `${vehicle.name}が戻りました` : `${vehicle.name}を利用可能に戻しました`);
  const now = toLocalInput(new Date());
  const nowEndMax = addDays(now, MAINTENANCE_MAX_DAYS);
  const startMax = addDays(now, MAINTENANCE_SCHEDULE_DAYS_AHEAD);
  const laterEndMin = start && start > now ? start : now;
  const laterEndMax = addDays(laterEndMin, MAINTENANCE_MAX_DAYS);
  const newReady = timing === "now" ? canStartNow && actorReady && inRange(end, now, nowEndMax) : !!start && !!end && inRange(start, now, startMax) && end > start && inRange(end, laterEndMin, laterEndMax);
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
  const edited = !!active && (note !== (active.note ?? "") || end !== toLocalInput(active.plannedEnd)) && inRange(end, now, nowEndMax);

  return <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm" onKeyDown={(event) => { if (event.key === "Escape" && !submitting) onClose(); }}>
    <div role="dialog" data-focus-layer aria-modal="true" aria-labelledby="maintenance-title" aria-busy={submitting} className="relative max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl">
      <button type="button" aria-label="閉じる" disabled={submitting} onClick={onClose} className="absolute right-4 top-4 grid size-9 place-items-center rounded-full text-slate-500 hover:bg-slate-100"><X className="size-4" /></button>
      <div className="flex items-center gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-700"><Wrench className="size-5" /></span><div><h2 id="maintenance-title" className="text-lg font-black">{vehicle.name}の車検・故障</h2><p className="text-xs text-slate-500">{vehicle.plateNumber} ・ {vehicle.code}</p></div></div>
      {!fromSettings && !inMaintenance && canStartNow ? <div className="mt-5"><ActorSelect label="操作する人" hint="「今すぐ」や予定の「開始」で出すときに、履歴に残します" employees={employees} value={actorId} onChange={setActorId} /></div> : null}

      {inMaintenance ? <div className="mt-5 space-y-4">
        <div className="rounded-2xl bg-amber-50 p-4 text-sm"><p className="font-black text-amber-900">{active ? MAINTENANCE_KIND_LABELS[active.kind] : "整備中"}</p>{active ? <p className="mt-1 text-xs font-bold text-amber-800">{formatMaintenanceTime(active.actualStart ?? active.plannedStart)}から ・ 戻り予定 {active.plannedEnd ? formatMaintenanceTime(active.plannedEnd) : "未定"}</p> : null}{active?.note ? <p className="mt-1 text-xs text-amber-900">{active.note}</p> : null}</div>
        {active ? <fieldset disabled={submitting} className="space-y-3 rounded-2xl border border-slate-200 p-4">
          <legend className="px-1 text-xs font-black text-slate-600">内容を変更</legend>
          <label className="block"><span className="mb-1 block text-xs font-bold text-slate-600">戻り予定（未定なら空欄）</span><input type="datetime-local" className={field} min={now} max={nowEndMax} value={end} onChange={(event) => setEnd(event.target.value)} /><span className="mt-1 block text-[11px] text-slate-500">今から{MAINTENANCE_MAX_DAYS}日以内</span></label>
          <label className="block"><span className="mb-1 block text-xs font-bold text-slate-600">備考（任意）</span><input className={field} maxLength={MAINTENANCE_NOTE_MAX} value={note} onChange={(event) => setNote(event.target.value)} placeholder="例：〇〇整備工場、タイヤ交換" /></label>
          <Button variant="ghost" className="w-full" disabled={!edited} onClick={() => run({ action: "updateMaintenance", maintenanceId: active.id, version: active.version, note, plannedEnd: fromLocalInput(end) }, `${vehicle.name}の整備内容を変更しました`)}>変更を保存</Button>
        </fieldset> : null}
        <div className="space-y-2 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4">
          <p className="text-xs font-black text-emerald-800">{active?.kind === "OFF_SITE" ? "戻った車両を停める区画" : "整備後の駐車位置"}</p>
          <ReturnSpotSelect vehicle={vehicle} data={data} value={spotId} onChange={setSpotId} disabled={submitting} />
          {fromSettings ? null : <ActorSelect label={active?.kind === "OFF_SITE" ? "戻した人" : "解除した人"} employees={employees} value={actorId} onChange={setActorId} />}
          <Button className="w-full" disabled={submitting || !actorReady} onClick={finish}><CarFront className="size-4" />{submitting ? "処理中…" : active?.kind === "OFF_SITE" ? "戻った" : "整備を解除"}</Button>
        </div>
      </div> : <fieldset disabled={submitting} className="mt-5 space-y-4">
        <div role="radiogroup" aria-label="整備の種類" className="grid gap-2">{KIND_ORDER.map((item) => <label key={item} className={cn("flex cursor-pointer gap-3 rounded-2xl border p-3", kind === item ? "border-amber-300 bg-amber-50" : "border-slate-200")}><input type="radio" name="maintenance-kind" className="mt-1 size-4 accent-amber-600" checked={kind === item} onChange={() => setKind(item)} /><span><span className="block text-sm font-black">{MAINTENANCE_KIND_LABELS[item]}</span><span className="block text-xs text-slate-500">{KIND_HINTS[item]}</span></span></label>)}</div>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">{(["later", "now"] as const).map((item) => <button key={item} type="button" disabled={item === "now" && !canStartNow} onClick={() => setTiming(item)} className={cn("min-h-9 rounded-lg text-xs font-bold disabled:opacity-40", timing === item ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>{item === "now" ? "今すぐ" : "予定を登録"}</button>)}</div>
        {!canStartNow ? <p className="text-xs font-bold text-amber-700">利用中の車両は、返却後に整備を始められます。予定は登録できます。</p> : null}
        {timing === "later" ? <label className="block"><span className="mb-1 block text-xs font-bold text-slate-600">開始予定</span><input required type="datetime-local" className={field} min={now} max={startMax} value={start} onChange={(event) => setStart(event.target.value)} /><span className="mt-1 block text-[11px] text-slate-500">1年先まで登録できます</span></label> : null}
        <label className="block"><span className="mb-1 block text-xs font-bold text-slate-600">{timing === "now" ? "戻り予定（任意）" : "戻り予定"}</span><input required={timing === "later"} type="datetime-local" className={field} min={timing === "now" ? now : laterEndMin} max={timing === "now" ? nowEndMax : laterEndMax} value={end} onChange={(event) => setEnd(event.target.value)} />{timing === "now" ? <span className="mt-1 block text-[11px] text-slate-500">今から{MAINTENANCE_MAX_DAYS}日以内。決まっていれば、その後の時間を予約できます</span> : <span className="mt-1 block text-[11px] text-slate-500">開始から{MAINTENANCE_MAX_DAYS}日以内。この期間は予約できなくなります</span>}</label>
        <label className="block"><span className="mb-1 block text-xs font-bold text-slate-600">備考（任意）</span><input className={field} maxLength={MAINTENANCE_NOTE_MAX} value={note} onChange={(event) => setNote(event.target.value)} placeholder="例：〇〇整備工場、タイヤ交換" /></label>
        <Button className="w-full" disabled={!newReady} onClick={() => void submitNew()}>{submitting ? "処理中…" : timing === "now" ? `${MAINTENANCE_KIND_SHORT_LABELS[kind]}にする` : "予定を登録"}</Button>
      </fieldset>}

      {scheduled.length ? <div className="mt-5 space-y-2"><p className="flex items-center gap-1.5 text-xs font-black text-slate-600"><CalendarClock className="size-3.5" />登録済みの整備予定</p>{scheduled.map((item) => editing?.id === item.id ? <fieldset key={item.id} disabled={submitting} className="space-y-3 rounded-xl border border-amber-300 bg-amber-50/40 p-3">
        <legend className="px-1 text-xs font-black text-amber-800">{MAINTENANCE_KIND_SHORT_LABELS[item.kind]}の予定を変更</legend>
        <label className="block"><span className="mb-1 block text-xs font-bold text-slate-600">開始予定</span><input type="datetime-local" className={field} min={now} max={startMax} value={editing.start} onChange={(event) => setEditing({ ...editing, start: event.target.value })} /></label>
        <label className="block"><span className="mb-1 block text-xs font-bold text-slate-600">戻り予定</span><input type="datetime-local" className={field} min={editing.start} max={addDays(editing.start > now ? editing.start : now, MAINTENANCE_MAX_DAYS)} value={editing.end} onChange={(event) => setEditing({ ...editing, end: event.target.value })} /><span className="mt-1 block text-[11px] text-slate-500">開始から{MAINTENANCE_MAX_DAYS}日以内。この期間は予約できなくなります</span></label>
        <label className="block"><span className="mb-1 block text-xs font-bold text-slate-600">備考（任意）</span><input className={field} maxLength={MAINTENANCE_NOTE_MAX} value={editing.note} onChange={(event) => setEditing({ ...editing, note: event.target.value })} placeholder="例：〇〇整備工場、タイヤ交換" /></label>
        <div className="grid grid-cols-2 gap-2"><Button variant="ghost" onClick={() => setEditing(null)}>やめる</Button><Button disabled={!editReady} onClick={() => void saveEdit()}>{submitting ? "処理中…" : "変更を保存"}</Button></div>
      </fieldset> : <div key={item.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 p-3"><div className="mr-auto min-w-0"><p className="text-sm font-bold">{periodText(item)}</p><p className="text-xs text-slate-500">{MAINTENANCE_KIND_SHORT_LABELS[item.kind]}{item.note ? ` ・ ${item.note}` : ""}</p></div><button type="button" disabled={submitting} onClick={() => setEditing({ id: item.id, start: toLocalInput(item.plannedStart), end: toLocalInput(item.plannedEnd), note: item.note ?? "" })} className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40">変更</button><button type="button" disabled={submitting || !canStartNow || !actorReady} onClick={() => void startScheduled(item)} className="min-h-9 rounded-lg border border-amber-200 px-3 text-xs font-bold text-amber-700 hover:bg-amber-50 disabled:opacity-40">開始</button><button type="button" disabled={submitting} onClick={() => void run({ action: "cancelMaintenance", maintenanceId: item.id, version: item.version }, "整備予定を取り消しました")} className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40">取消</button></div>)}</div> : null}
    </div>
  </div>;
}

// 駐車場の画面から、登録済みの予定どおり車検・整備に出す。予定は予約を止めるためのもので、実際に出たことはこの操作で記録する。
export function SendOutDialog({ vehicle, maintenance, data, mutate, currentEmployeeId, onClose }: { vehicle: Vehicle; maintenance: VehicleMaintenance; data: DashboardData; mutate: Mutate; currentEmployeeId: string | null; onClose: () => void }) {
  const employees = activeEmployeesOf(data);
  const [actorId, setActorId] = useState(() => initialActor(employees, currentEmployeeId));
  const [end, setEnd] = useState(toLocalInput(maintenance.plannedEnd && new Date(maintenance.plannedEnd) > new Date() ? maintenance.plannedEnd : null));
  const [submitting, setSubmitting] = useState(false);
  const offSite = maintenance.kind === "OFF_SITE";
  const spot = data.spots.find((item) => item.id === vehicle.parkingSpotId);
  const now = toLocalInput(new Date());
  const nowEndMax = addDays(now, MAINTENANCE_MAX_DAYS);
  const canStartNow = vehicle.status === "AVAILABLE";
  const ready = !!actorId && canStartNow && inRange(end, now, nowEndMax);
  const actionLabel = offSite ? "車検に出す" : "整備中にする";
  const submit = async () => {
    if (submitting || !ready) return;
    setSubmitting(true);
    try {
      if (await mutate({ action: "startMaintenance", vehicleId: vehicle.id, version: vehicle.version, kind: maintenance.kind, note: maintenance.note, plannedEnd: fromLocalInput(end), maintenanceId: maintenance.id, actorEmployeeId: actorId }, `${vehicle.name}を${MAINTENANCE_KIND_SHORT_LABELS[maintenance.kind]}にしました`)) onClose();
    } finally { setSubmitting(false); }
  };
  return <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm" onKeyDown={(event) => { if (event.key === "Escape" && !submitting) onClose(); }}>
    <div role="dialog" data-focus-layer aria-modal="true" aria-labelledby="send-out-title" aria-busy={submitting} className="relative max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl">
      <button type="button" aria-label="閉じる" disabled={submitting} onClick={onClose} className="absolute right-4 top-4 grid size-9 place-items-center rounded-full text-slate-500 hover:bg-slate-100"><X className="size-4" /></button>
      <div className="flex items-center gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-700"><Wrench className="size-5" /></span><div><h2 id="send-out-title" className="text-lg font-black">{vehicle.name}を{actionLabel}</h2><p className="text-xs text-slate-500">{vehicle.plateNumber} ・ {vehicle.code}</p></div></div>
      <fieldset disabled={submitting} className="mt-5 space-y-4">
        <div className="rounded-2xl bg-amber-50 p-4 text-sm"><p className="font-black text-amber-900">{MAINTENANCE_KIND_LABELS[maintenance.kind]}</p><p className="mt-1 text-xs font-bold text-amber-800">予定 {periodText(maintenance)}</p>{maintenance.note ? <p className="mt-1 text-xs text-amber-900">{maintenance.note}</p> : null}<p className="mt-2 text-xs text-amber-800">{offSite ? `${spot ? `${formatSpotLabel(spot)}を空けます。` : ""}戻るまで、ほかの車を停められます。` : "区画に置いたまま、使えない状態にします。"}</p></div>
        <ActorSelect label={offSite ? "出す人" : "操作する人"} employees={employees} value={actorId} onChange={setActorId} />
        <label className="block"><span className="mb-1 block text-xs font-bold text-slate-600">戻り予定（未定なら空欄）</span><input type="datetime-local" className={field} min={now} max={nowEndMax} value={end} onChange={(event) => setEnd(event.target.value)} /><span className="mt-1 block text-[11px] text-slate-500">日程がずれたときは、ここで直せます</span></label>
        {!canStartNow ? <p className="text-xs font-bold text-amber-700">利用中の車両は、返却してから出せます。</p> : null}
        <Button className="w-full bg-amber-600 hover:bg-amber-700" disabled={!ready} onClick={() => void submit()}><Wrench className="size-4" />{submitting ? "処理中…" : actionLabel}</Button>
      </fieldset>
    </div>
  </div>;
}
