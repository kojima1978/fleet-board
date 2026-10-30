"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, MapPin, PenLine } from "lucide-react";
import type { DashboardData, ParkingSpot, Vehicle } from "@/lib/types";
import { PARKING_SPOT_ROLES, SPOT_LABEL_MAX_LENGTH, SPOT_ROLE_DESCRIPTIONS, SPOT_ROLE_LABELS, defaultSpotTag, isDashedSpot, spotRoleTag, type ParkingSpotRole } from "@/lib/parking-spots";
import { Button, Card, cn } from "./ui";

type Mutate = (body: object, success: string) => Promise<boolean>;

const roleBadge: Record<ParkingSpotRole, string> = {
  REGULAR: "bg-slate-100 text-slate-600",
  TEMPORARY: "bg-sky-50 text-sky-700",
  CUSTOMER: "bg-amber-50 text-amber-700",
  DEDICATED: "bg-violet-50 text-violet-700",
  HOLDING: "bg-zinc-200 text-zinc-700",
};
const roleTile: Record<ParkingSpotRole, string> = {
  REGULAR: "border-slate-300 bg-white/90",
  TEMPORARY: "border-sky-300 bg-sky-50/90",
  CUSTOMER: "border-amber-300 bg-amber-50/90",
  DEDICATED: "border-violet-300 bg-violet-50/90",
  HOLDING: "border-zinc-400 bg-zinc-100/90",
};
const field = "min-h-10 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm disabled:opacity-50";

// 区画番号と表示名はサーバーと同じく全角を半角へそろえ、前後の空白を除いて比べる。
const normalizeCode = (value: string) => value.normalize("NFKC").trim();

// 配置図で区画を選び、区画番号と用途（通常・一時・お客様用・専用・仮置き）を変更する管理画面。
export function SpotRoleSettings({ data, mutate }: { data: DashboardData; mutate: Mutate }) {
  const vehicles = data.vehicles.filter((vehicle) => vehicle.active);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = data.spots.find((spot) => spot.id === selectedId) ?? null;
  // 編集中の「手前の区画」を配置図に黄色の枠で示す。
  const [draftFrontIds, setDraftFrontIds] = useState<string[]>([]);
  const frontIds = selected ? draftFrontIds : [];
  const sortedSpots = [...data.spots].sort((a, b) => a.code.localeCompare(b.code, "ja", { numeric: true }));
  return <div className="grid w-full max-w-[1092px] gap-3 xl:grid-cols-[minmax(0,760px)_320px]">
    <Card className="p-3 md:p-4">
      <p className="mb-2 text-xs font-bold text-slate-500">変更する区画を配置図からタップしてください</p>
      <div className="@container relative mx-auto aspect-[950/525] overflow-hidden rounded-xl border border-slate-200 bg-white" style={{ width: "min(100%, calc((100vh - 290px) * 1.81))" }}>
        <img src="/parking-layout.svg" alt="" className="pointer-events-none absolute inset-0 size-full select-none" draggable={false} />
        {data.spots.map((spot) => <button key={spot.id} type="button" aria-pressed={spot.id === selectedId} title={`区画 ${spot.code}を選ぶ`} onClick={() => setSelectedId((current) => current === spot.id ? null : spot.id)} className={cn("absolute grid place-content-center rounded-[4px] border-2 text-center transition hover:border-blue-400", roleTile[spot.role], isDashedSpot(spot) && "border-[3px] border-dashed", !spot.enabled && "opacity-50", frontIds.includes(spot.id) && "border-solid border-amber-500 bg-amber-100 ring-2 ring-amber-300", spot.id === selectedId && "z-10 border-solid border-blue-500 bg-blue-50 ring-4 ring-blue-300")} style={{ left: `${spot.x}%`, top: `${spot.y}%`, width: `${spot.width}%`, height: `${spot.height}%` }}>
          <span className="block text-[10px] font-black leading-none text-slate-800 @2xl:text-sm">{spot.code}</span>
          {spotRoleTag(spot) ? <span className="mt-0.5 block truncate px-0.5 text-[7px] font-bold leading-none text-slate-500 @2xl:text-[10px]">{spotRoleTag(spot)}</span> : null}
          {spot.label ? <PenLine aria-label="表示名を変更済み" className="absolute right-0.5 top-0.5 size-2 text-blue-500 @2xl:size-3" /> : null}
        </button>)}
      </div>
    </Card>
    <div className="space-y-3 xl:sticky xl:top-4 xl:self-start">
      <Card className="p-4">
        <label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-600">変更する区画</span>
          <select aria-label="変更する区画" value={selectedId ?? ""} onChange={(event) => setSelectedId(event.target.value || null)} className={field}>
            <option value="">配置図または一覧から選ぶ</option>
            {sortedSpots.map((spot) => <option key={spot.id} value={spot.id}>{spot.code}（{spotRoleTag(spot) || SPOT_ROLE_LABELS[spot.role]}）</option>)}
          </select>
        </label>
        {selected ? <SpotEditor key={selected.id} spot={selected} spots={data.spots} vehicles={vehicles} mutate={mutate} onFrontChange={setDraftFrontIds} /> : <div className="mt-4 grid place-items-center rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-xs text-slate-400"><MapPin className="mb-1 size-5" />区画を選ぶと、区画番号と用途を変更できます</div>}
      </Card>
      <Card className="p-4">
        <h3 className="text-sm font-black">用途の種類</h3>
        <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2 xl:grid-cols-1">
          {PARKING_SPOT_ROLES.map((role) => <div key={role} className="flex items-start gap-2"><dt className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-black", roleBadge[role])}>{SPOT_ROLE_LABELS[role]}</dt><dd className="pt-0.5 text-slate-500">{SPOT_ROLE_DESCRIPTIONS[role]}</dd></div>)}
        </dl>
        <p className="mt-3 flex items-center gap-1.5 border-t border-slate-100 pt-3 text-xs text-slate-500"><PenLine className="size-3.5 text-blue-500" />表示名を変更した区画</p>
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500"><span aria-hidden="true" className="size-3.5 rounded-[3px] border-2 border-amber-500 bg-amber-100" />選んだ区画の手前の区画</p>
      </Card>
    </div>
  </div>;
}

function SpotEditor({ spot, spots, vehicles, mutate, onFrontChange }: { spot: ParkingSpot; spots: ParkingSpot[]; vehicles: Vehicle[]; mutate: Mutate; onFrontChange: (ids: string[]) => void }) {
  const [code, setCode] = useState(spot.code);
  const [role, setRole] = useState<ParkingSpotRole>(spot.role);
  const [vehicleId, setVehicleId] = useState(spot.dedicatedVehicleId ?? "");
  const [label, setLabel] = useState(spot.label ?? "");
  // 表示名は「自動」（用途から決まる名前）か「任意」（入力した名前）のどちらか。
  const [labelMode, setLabelMode] = useState<"auto" | "custom">(spot.label ? "custom" : "auto");
  const [frontIds, setFrontIds] = useState(spot.frontSpotIds);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  // 保存後や他の端末で変わったときは、最新の内容で入力し直す。
  const savedFrontKey = spot.frontSpotIds.join();
  useEffect(() => { setCode(spot.code); setRole(spot.role); setVehicleId(spot.dedicatedVehicleId ?? ""); setLabel(spot.label ?? ""); setLabelMode(spot.label ? "custom" : "auto"); setFrontIds(savedFrontKey ? savedFrontKey.split(",") : []); }, [spot.code, spot.role, spot.dedicatedVehicleId, spot.label, savedFrontKey]);
  useEffect(() => { onFrontChange(frontIds); }, [frontIds, onFrontChange]);
  useEffect(() => {
    if (!confirming) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) setConfirming(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming, saving]);
  const nextCode = normalizeCode(code);
  const nextLabel = labelMode === "custom" ? normalizeCode(label) || null : null;
  const dedicatedVehicleId = role === "DEDICATED" ? vehicleId || null : null;
  const dedicatedVehicleName = vehicles.find((vehicle) => vehicle.id === dedicatedVehicleId)?.name ?? null;
  const autoLabel = defaultSpotTag({ code: nextCode, role, dedicatedVehicleId, dedicatedVehicleName });
  // 手前の区画の候補。仮置きは実在しないので出さない。
  const frontCandidates = spots.filter((item) => item.id !== spot.id && item.role !== "HOLDING").sort((a, b) => a.code.localeCompare(b.code, "ja", { numeric: true }));
  const toggleFront = (id: string) => setFrontIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const codeChanged = nextCode !== spot.code;
  const frontChanged = [...frontIds].sort().join() !== [...spot.frontSpotIds].sort().join();
  const changed = codeChanged || frontChanged || nextLabel !== spot.label || role !== spot.role || dedicatedVehicleId !== (spot.role === "DEDICATED" ? spot.dedicatedVehicleId : null);
  const codeError = !nextCode ? "区画番号を入力してください" : nextCode.length > 12 ? "区画番号は12文字以内で入力してください" : /\s/.test(nextCode) ? "区画番号に空白は使えません" : codeChanged && spots.some((item) => item.id !== spot.id && item.code === nextCode) ? `区画番号${nextCode}はすでに使われています` : "";
  const labelError = labelMode === "custom" && !nextLabel ? "表示名を入力するか、自動を選んでください" : (nextLabel?.length ?? 0) > SPOT_LABEL_MAX_LENGTH ? `表示名は${SPOT_LABEL_MAX_LENGTH}文字以内で入力してください` : "";
  // 専用にするとき、別の車がすでに停まっている区画は先に移動してもらう。
  const blockedByParked = role === "DEDICATED" && !!spot.vehicle && !!vehicleId && spot.vehicle.id !== vehicleId;
  const valid = !codeError && !labelError && (role !== "DEDICATED" || (!!vehicleId && !blockedByParked));
  // 用途や専用車両を変えたら、前の用途に合わせた表示名は使わず自動に戻す。
  const changeRole = (value: ParkingSpotRole) => { setRole(value); setLabel(""); setLabelMode("auto"); };
  const changeVehicle = (value: string) => { setVehicleId(value); setLabel(""); setLabelMode("auto"); };
  const save = async () => {
    if (!changed || !valid || saving) return;
    setSaving(true);
    try {
      const ok = await mutate({ action: "updateSpot", id: spot.id, version: spot.version, code: nextCode, label: nextLabel ?? "", role, dedicatedVehicleId, frontSpotIds: frontIds }, codeChanged ? `区画 ${spot.code} を ${nextCode} に変更しました` : `区画 ${spot.code} の設定を変更しました`);
      if (ok) setConfirming(false);
    } finally { setSaving(false); }
  };
  // 番号は返却先や印刷にも出るため、変えるときだけ保存前に確認する。
  const requestSave = () => { if (!changed || !valid || saving) return; if (codeChanged) setConfirming(true); else void save(); };
  return <div data-kiosk-auto-home-blocked={changed || saving} className="mt-4 space-y-3">
    <label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-600">区画番号</span>
      <input aria-label={`区画 ${spot.code}の番号`} disabled={saving} value={code} maxLength={20} onChange={(event) => setCode(event.target.value)} className={cn(field, codeError && "border-rose-300")} />
      {codeError ? <span className="mt-1 block text-[11px] font-bold text-rose-600">{codeError}</span> : <span className="mt-1 block text-[11px] text-slate-400">過去の利用履歴は、変更前の番号のまま残ります</span>}
    </label>
    <label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-600">用途</span>
      <select aria-label={`区画 ${spot.code}の用途`} disabled={saving} value={role} onChange={(event) => changeRole(event.target.value as ParkingSpotRole)} className={field}>
        {PARKING_SPOT_ROLES.map((item) => <option key={item} value={item}>{SPOT_ROLE_LABELS[item]}</option>)}
      </select>
    </label>
    {role === "DEDICATED" ? <label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-600">専用にする車両</span>
      <select aria-label={`区画 ${spot.code}の専用車両`} disabled={saving} value={vehicleId} onChange={(event) => changeVehicle(event.target.value)} className={field}>
        <option value="">車両を選択</option>
        {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.code} {vehicle.name}</option>)}
      </select>
      {blockedByParked ? <span className="mt-1 block text-[11px] font-bold text-rose-600">{spot.vehicle?.name}が駐車中です。先に移動してください</span> : null}
    </label> : null}
    <fieldset disabled={saving}><legend className="mb-1.5 block text-xs font-bold text-slate-600">表示名</legend>
      <span className="grid grid-cols-2 gap-1.5">{([["auto", `自動（${autoLabel || "表示なし"}）`], ["custom", "任意"]] as const).map(([value, text]) => <button key={value} type="button" aria-pressed={labelMode === value} onClick={() => setLabelMode(value)} className={cn("min-h-10 truncate rounded-xl border px-2 text-xs font-bold transition disabled:opacity-50", labelMode === value ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>{text}</button>)}</span>
      {labelMode === "custom" ? <input aria-label={`区画 ${spot.code}の表示名`} autoFocus={!spot.label} value={label} maxLength={SPOT_LABEL_MAX_LENGTH + 10} placeholder={`${SPOT_LABEL_MAX_LENGTH}文字以内`} onChange={(event) => setLabel(event.target.value)} className={cn(field, "mt-1.5", labelError && "border-rose-300")} /> : null}
      {labelError ? <span className="mt-1 block text-[11px] font-bold text-rose-600">{labelError}</span> : <span className="mt-1 block text-[11px] text-slate-400">{labelMode === "auto" ? autoLabel ? `配置図には「${autoLabel}」と出します` : "配置図には何も出しません" : "配置図で番号の横に出す名前です"}</span>}
    </fieldset>
    <fieldset disabled={saving}><legend className="mb-1.5 block text-xs font-bold text-slate-600">手前の区画<span className="ml-1 font-normal text-slate-400">（任意）</span></legend>
      <span className="flex flex-wrap gap-1">{frontCandidates.map((item) => <button key={item.id} type="button" aria-pressed={frontIds.includes(item.id)} aria-label={`区画 ${item.code}を手前の区画にする`} onClick={() => toggleFront(item.id)} className={cn("min-w-9 rounded-full border px-2 py-0.5 text-[11px] font-bold transition disabled:opacity-50", frontIds.includes(item.id) ? "border-amber-500 bg-amber-50 text-amber-800" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>{item.code}</button>)}</span>
      <span className="mt-1 block text-[11px] text-slate-400">中央の道路側にある区画を選びます。出庫・入庫のとき、ここに車があれば注意を出します（登録は止めません）</span>
    </fieldset>
    <button type="button" disabled={!changed || !valid || saving} onClick={requestSave} className="inline-flex min-h-10 w-full items-center justify-center gap-1 rounded-xl bg-blue-600 px-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-40"><Check className="size-4" />保存</button>
    {/* 配置図の選択枠より前に出すため、確認画面は body 直下に描く。 */}
    {confirming ? createPortal(<div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm"><div role="alertdialog" aria-modal="true" aria-busy={saving} aria-labelledby="spot-code-confirm-title" className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-blue-50 text-blue-600"><PenLine /></span>
      <h2 id="spot-code-confirm-title" className="mt-4 text-center text-lg font-black">区画 {spot.code} を {nextCode} に変更しますか？</h2>
      <ul className="mt-4 space-y-1.5 rounded-2xl bg-slate-50 p-4 text-xs text-slate-600">
        {["配置図・返却先の選択・印刷は新しい番号で表示します", `過去の利用履歴は「${spot.code}」のまま残ります`, ...(spot.vehicle ? [`駐車中の${spot.vehicle.name}はこの区画に置いたままです`] : [])].map((effect) => <li key={effect} className="flex gap-2"><span aria-hidden="true" className="text-slate-400">・</span><span>{effect}</span></li>)}
      </ul>
      <div className="mt-5 grid grid-cols-2 gap-2"><Button autoFocus variant="ghost" disabled={saving} onClick={() => setConfirming(false)}>キャンセル</Button><Button disabled={saving} onClick={() => void save()}>{saving ? "処理中…" : "変更する"}</Button></div>
    </div></div>, document.body) : null}
  </div>;
}
