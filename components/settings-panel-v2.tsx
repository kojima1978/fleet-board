"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CarFront, Check, Nfc, Pencil, Plus, Power, Search, UserRound, X } from "lucide-react";
import type { DashboardData, Employee, Vehicle } from "@/lib/types";
import { Button, Card, cn } from "./ui";

type Mutate = (body: object, success: string) => Promise<boolean>;
type StatusFilter = "all" | "active" | "inactive" | "inUse";
type ConfirmTarget = { id: string; name: string; active: boolean; version: number };

const emptyEmployee = { code: "", name: "", department: "", nfcUid: "" };
const emptyVehicle = { code: "", name: "", plateNumber: "", nfcUid: "", color: "#2563eb" };
const field = "min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500";

export function SettingsPanelV2({ kind, data, mutate }: { kind: "employee" | "vehicle"; data: DashboardData; mutate: Mutate }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [department, setDepartment] = useState("all");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [employeeForm, setEmployeeForm] = useState(emptyEmployee);
  const [vehicleForm, setVehicleForm] = useState(emptyVehicle);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [highlightId, setHighlightId] = useState("");
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const [urlHydrated, setUrlHydrated] = useState(false);
  const nfcInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setQuery(params.get("q") ?? "");
    const savedStatus = params.get("status") as StatusFilter | null;
    if (savedStatus && ["all", "active", "inactive", "inUse"].includes(savedStatus)) setStatus(savedStatus);
    setDepartment(params.get("department") ?? "all");
    setUrlHydrated(true);
  }, [kind]);

  useEffect(() => {
    if (!urlHydrated) return;
    const params = new URLSearchParams(window.location.search);
    query ? params.set("q", query) : params.delete("q");
    status !== "all" ? params.set("status", status) : params.delete("status");
    kind === "employee" && department !== "all" ? params.set("department", department) : params.delete("department");
    const suffix = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${suffix ? `?${suffix}` : ""}`);
  }, [department, kind, query, status, urlHydrated]);

  useEffect(() => {
    if (!highlightId) return;
    const timer = window.setTimeout(() => setHighlightId(""), 3000);
    return () => window.clearTimeout(timer);
  }, [highlightId]);

  const departments = useMemo(() => [...new Set(data.employees.map((person) => person.department))].sort((a, b) => a.localeCompare(b, "ja")), [data.employees]);
  const normalizedQuery = query.trim().toLowerCase();
  const employees = useMemo(() => data.employees.filter((person) => {
    const matchesQuery = !normalizedQuery || [person.code, person.name, person.department, person.nfcUid].some((value) => value.toLowerCase().includes(normalizedQuery));
    const matchesStatus = status === "all" || (status === "active" && person.active) || (status === "inactive" && !person.active);
    return matchesQuery && matchesStatus && (department === "all" || person.department === department);
  }), [data.employees, department, normalizedQuery, status]);
  const vehicles = useMemo(() => data.vehicles.filter((vehicle) => {
    const matchesQuery = !normalizedQuery || [vehicle.code, vehicle.name, vehicle.plateNumber, vehicle.nfcUid].some((value) => value.toLowerCase().includes(normalizedQuery));
    const matchesStatus = status === "all" || (status === "active" && vehicle.active) || (status === "inactive" && !vehicle.active) || (status === "inUse" && vehicle.active && vehicle.status === "IN_USE");
    return matchesQuery && matchesStatus;
  }), [data.vehicles, normalizedQuery, status]);

  const currentNfc = kind === "employee" ? employeeForm.nfcUid : vehicleForm.nfcUid;
  const editingId = editingEmployee?.id ?? editingVehicle?.id;
  const duplicateNfc = [...data.employees, ...data.vehicles].find((item) => item.id !== editingId && item.nfcUid.toLowerCase() === currentNfc.trim().toLowerCase());

  const employeeDirty = JSON.stringify(employeeForm) !== JSON.stringify(editingEmployee ? { code: editingEmployee.code, name: editingEmployee.name, department: editingEmployee.department, nfcUid: editingEmployee.nfcUid } : emptyEmployee);
  const vehicleDirty = JSON.stringify(vehicleForm) !== JSON.stringify(editingVehicle ? { code: editingVehicle.code, name: editingVehicle.name, plateNumber: editingVehicle.plateNumber, nfcUid: editingVehicle.nfcUid, color: editingVehicle.color } : emptyVehicle);
  const closeDrawer = (force = false) => {
    if (!force && drawerOpen && (kind === "employee" ? employeeDirty : vehicleDirty)) { setDiscardConfirm(true); return; }
    setDrawerOpen(false); setEditingEmployee(null); setEditingVehicle(null); setEmployeeForm(emptyEmployee); setVehicleForm(emptyVehicle); setScanning(false);
  };
  const openCreate = () => { closeDrawer(true); setDrawerOpen(true); };
  const openEmployee = (person: Employee) => {
    setEditingEmployee(person); setEmployeeForm({ code: person.code, name: person.name, department: person.department, nfcUid: person.nfcUid }); setDrawerOpen(true);
  };
  const openVehicle = (vehicle: Vehicle) => {
    setEditingVehicle(vehicle); setVehicleForm({ code: vehicle.code, name: vehicle.name, plateNumber: vehicle.plateNumber, nfcUid: vehicle.nfcUid, color: vehicle.color }); setDrawerOpen(true);
  };
  const beginNfcScan = () => { setScanning(true); window.setTimeout(() => nfcInput.current?.focus(), 0); };
  const submitEmployee = async (event: React.FormEvent) => {
    event.preventDefault(); if (duplicateNfc) return; setSubmitting(true);
    const body = editingEmployee ? { action: "updateEmployee", id: editingEmployee.id, version: editingEmployee.version, name: employeeForm.name, department: employeeForm.department, nfcUid: employeeForm.nfcUid } : { action: "createEmployee", ...employeeForm };
    const ok = await mutate(body, editingEmployee ? "社員情報を修正しました" : "社員を登録しました");
    if (ok) { if (editingEmployee) setHighlightId(editingEmployee.id); closeDrawer(true); }
    setSubmitting(false);
  };
  const submitVehicle = async (event: React.FormEvent) => {
    event.preventDefault(); if (duplicateNfc) return; setSubmitting(true);
    const body = editingVehicle ? { action: "updateVehicle", id: editingVehicle.id, version: editingVehicle.version, name: vehicleForm.name, plateNumber: vehicleForm.plateNumber, nfcUid: vehicleForm.nfcUid, color: vehicleForm.color } : { action: "createVehicle", ...vehicleForm };
    const ok = await mutate(body, editingVehicle ? "車両情報を修正しました" : "車両を登録しました");
    if (ok) { if (editingVehicle) setHighlightId(editingVehicle.id); closeDrawer(true); }
    setSubmitting(false);
  };
  const applyActiveChange = async () => {
    if (!confirmTarget) return;
    const action = kind === "employee" ? "setEmployeeActive" : "setVehicleActive";
    const ok = await mutate({ action, id: confirmTarget.id, version: confirmTarget.version, active: !confirmTarget.active }, confirmTarget.active ? `${kind === "employee" ? "社員" : "車両"}を無効化しました` : `${kind === "employee" ? "社員" : "車両"}を再有効化しました`);
    if (ok) setHighlightId(confirmTarget.id);
    setConfirmTarget(null);
  };

  const total = kind === "employee" ? data.employees.length : data.vehicles.length;
  const active = kind === "employee" ? data.employees.filter((person) => person.active).length : data.vehicles.filter((vehicle) => vehicle.active).length;
  const shown = kind === "employee" ? employees.length : vehicles.length;

  return <>
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input aria-label={`${kind === "employee" ? "社員" : "車両"}を検索`} className={cn(field, "pl-9")} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={kind === "employee" ? "社員番号・氏名・部署・NFC UIDで検索" : "車両番号・車両名・ナンバー・NFC UIDで検索"} /></div>
        <div className="flex flex-wrap gap-2">
          <select aria-label="状態で絞り込み" className={cn(field, "w-auto min-w-28")} value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}><option value="all">すべて</option><option value="active">有効</option><option value="inactive">無効</option>{kind === "vehicle" ? <option value="inUse">利用中</option> : null}</select>
          {kind === "employee" ? <select aria-label="部署で絞り込み" className={cn(field, "w-auto min-w-32")} value={department} onChange={(event) => setDepartment(event.target.value)}><option value="all">すべての部署</option>{departments.map((name) => <option key={name} value={name}>{name}</option>)}</select> : null}
          <Button onClick={openCreate}><Plus className="size-4" />{kind === "employee" ? "社員を追加" : "車両を追加"}</Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-4 py-3 text-xs text-slate-500"><span><b className="text-slate-900">{shown}</b>件を表示</span><span>有効 {active} / 全{total}{kind === "employee" ? "人" : "台"}</span></div>
      {shown === 0 ? <div className="p-10 text-center"><p className="text-sm text-slate-400">条件に一致する{kind === "employee" ? "社員" : "車両"}がありません</p><button type="button" onClick={() => { setQuery(""); setStatus("all"); setDepartment("all"); }} className="mt-3 rounded-lg px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50">検索条件をクリア</button></div> : <div className="divide-y divide-slate-100">
        {kind === "employee" ? employees.map((person) => <div key={person.id} className={cn("grid items-center gap-3 px-4 py-3 transition sm:grid-cols-[90px_minmax(0,1fr)_150px_220px]", !person.active && "bg-slate-50 text-slate-500", highlightId === person.id && "bg-amber-50 ring-2 ring-inset ring-amber-300")}>
          <span className="w-fit rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-black">{person.code}</span><div className="min-w-0"><p className="truncate text-sm font-black">{person.name}</p><p className="truncate text-xs text-slate-400 sm:hidden">{person.department} ・ {person.nfcUid}</p></div><div className="hidden min-w-0 sm:block"><p className="truncate text-xs font-bold">{person.department}</p><p className="truncate text-[11px] text-slate-400">{person.nfcUid}</p></div><RowActions active={person.active} name={person.name} onEdit={() => openEmployee(person)} onActive={() => setConfirmTarget({ id: person.id, name: person.name, active: person.active, version: person.version })} />
        </div>) : vehicles.map((vehicle) => <div key={vehicle.id} className={cn("grid items-center gap-3 px-4 py-3 transition sm:grid-cols-[48px_minmax(0,1fr)_150px_220px]", !vehicle.active && "bg-slate-50 text-slate-500", highlightId === vehicle.id && "bg-amber-50 ring-2 ring-inset ring-amber-300")}>
          <span className="grid size-10 place-items-center rounded-xl bg-slate-100"><CarFront className="size-5" style={{ color: vehicle.color }} /></span><div className="min-w-0"><p className="truncate text-sm font-black">{vehicle.code} ・ {vehicle.name}</p><p className="truncate text-xs text-slate-400">{vehicle.plateNumber} ・ {vehicle.nfcUid}</p></div><span className={cn("hidden w-fit rounded-full px-2.5 py-1 text-[10px] font-bold sm:inline", !vehicle.active ? "bg-slate-200 text-slate-600" : vehicle.status === "AVAILABLE" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700")}>{!vehicle.active ? "無効" : vehicle.status === "AVAILABLE" ? "利用可能" : vehicle.status === "IN_USE" ? "利用中" : vehicle.status}</span><RowActions active={vehicle.active} name={vehicle.name} onEdit={() => openVehicle(vehicle)} onActive={() => setConfirmTarget({ id: vehicle.id, name: vehicle.name, active: vehicle.active, version: vehicle.version })} />
        </div>)}
      </div>}
    </Card>

    {drawerOpen ? <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && closeDrawer()}><aside role="dialog" aria-modal="true" aria-label={kind === "employee" ? "社員情報" : "車両情報"} className="ml-auto flex h-full w-full max-w-md flex-col bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-slate-100 p-5"><div><p className="text-xs font-bold text-blue-600">{editingEmployee || editingVehicle ? "編集" : "新規登録"}</p><h2 className="mt-1 text-xl font-black">{kind === "employee" ? editingEmployee ? "社員情報を編集" : "社員を追加" : editingVehicle ? "車両情報を編集" : "車両を追加"}</h2></div><button aria-label="閉じる" onClick={() => closeDrawer()} className="grid size-10 place-items-center rounded-xl bg-slate-100"><X className="size-4" /></button></div>
      {kind === "employee" ? <form className="flex flex-1 flex-col overflow-y-auto p-5" onSubmit={submitEmployee}><div className="space-y-4"><Field label="社員番号"><input required disabled={!!editingEmployee} className={field} value={employeeForm.code} onChange={(event) => setEmployeeForm((current) => ({ ...current, code: event.target.value }))} placeholder="例：E007" /></Field><Field label="氏名"><input required className={field} value={employeeForm.name} onChange={(event) => setEmployeeForm((current) => ({ ...current, name: event.target.value }))} placeholder="例：山田 太郎" /></Field><Field label="部署"><input required className={field} value={employeeForm.department} onChange={(event) => setEmployeeForm((current) => ({ ...current, department: event.target.value }))} placeholder="例：営業部" /></Field><NfcField inputRef={nfcInput} value={employeeForm.nfcUid} scanning={scanning} duplicate={duplicateNfc?.name} onScan={beginNfcScan} onChange={(value) => setEmployeeForm((current) => ({ ...current, nfcUid: value }))} onDone={() => setScanning(false)} /></div><Button type="submit" className="mt-auto w-full" disabled={submitting || !!duplicateNfc}>{submitting ? "保存中…" : editingEmployee ? "変更を保存" : "社員を登録"}</Button></form> : <form className="flex flex-1 flex-col overflow-y-auto p-5" onSubmit={submitVehicle}><div className="space-y-4"><Field label="車両番号"><input required disabled={!!editingVehicle} className={field} value={vehicleForm.code} onChange={(event) => setVehicleForm((current) => ({ ...current, code: event.target.value }))} placeholder="例：C09" /></Field><Field label="車両名"><input required className={field} value={vehicleForm.name} onChange={(event) => setVehicleForm((current) => ({ ...current, name: event.target.value }))} placeholder="例：営業車9" /></Field><Field label="ナンバー"><input required className={field} value={vehicleForm.plateNumber} onChange={(event) => setVehicleForm((current) => ({ ...current, plateNumber: event.target.value }))} placeholder="例：品川 500 あ 12-34" /></Field><NfcField inputRef={nfcInput} value={vehicleForm.nfcUid} scanning={scanning} duplicate={duplicateNfc?.name} onScan={beginNfcScan} onChange={(value) => setVehicleForm((current) => ({ ...current, nfcUid: value }))} onDone={() => setScanning(false)} /><Field label="表示色"><span className="flex min-h-11 items-center gap-3 rounded-xl border border-slate-200 px-3"><input aria-label="車両の表示色" type="color" className="h-7 w-10 cursor-pointer border-0 bg-transparent p-0" value={vehicleForm.color} onChange={(event) => setVehicleForm((current) => ({ ...current, color: event.target.value }))} /><span className="text-xs font-bold text-slate-500">{vehicleForm.color.toUpperCase()}</span></span></Field></div><Button type="submit" className="mt-auto w-full" disabled={submitting || !!duplicateNfc}>{submitting ? "保存中…" : editingVehicle ? "変更を保存" : "車両を登録"}</Button></form>}
    </aside></div> : null}

    {confirmTarget ? <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm"><div role="alertdialog" aria-modal="true" className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl"><span className={cn("mx-auto grid size-12 place-items-center rounded-full", confirmTarget.active ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600")}>{confirmTarget.active ? <Power /> : <Check />}</span><h2 className="mt-4 text-center text-lg font-black">{confirmTarget.active ? "無効化しますか？" : "再有効化しますか？"}</h2><p className="mt-2 text-center text-sm text-slate-500">{confirmTarget.name}を{confirmTarget.active ? "利用開始の選択肢から除外します。過去の利用履歴は保持されます。" : "再び利用開始の選択肢へ表示します。"}</p><div className="mt-5 grid grid-cols-2 gap-2"><Button variant="ghost" onClick={() => setConfirmTarget(null)}>キャンセル</Button><Button variant={confirmTarget.active ? "danger" : "primary"} onClick={applyActiveChange}>{confirmTarget.active ? "無効化" : "再有効化"}</Button></div></div></div> : null}
    {discardConfirm ? <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm"><div role="alertdialog" aria-modal="true" className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl"><span className="mx-auto grid size-12 place-items-center rounded-full bg-amber-50 text-amber-600"><X /></span><h2 className="mt-4 text-center text-lg font-black">入力内容を破棄しますか？</h2><p className="mt-2 text-center text-sm text-slate-500">保存していない変更があります。この操作は元に戻せません。</p><div className="mt-5 grid grid-cols-2 gap-2"><Button variant="ghost" onClick={() => setDiscardConfirm(false)}>編集を続ける</Button><Button variant="danger" onClick={() => { setDiscardConfirm(false); closeDrawer(true); }}>破棄して閉じる</Button></div></div></div> : null}
  </>;
}

function RowActions({ active, name, onEdit, onActive }: { active: boolean; name: string; onEdit: () => void; onActive: () => void }) {
  return <div className="flex justify-end gap-2"><button type="button" onClick={onEdit} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 hover:bg-slate-50" aria-label={`${name}を編集`}><Pencil className="size-3.5" /><span className="hidden md:inline">編集</span></button><button type="button" onClick={onActive} className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-bold", active ? "border-rose-200 text-rose-600 hover:bg-rose-50" : "border-emerald-200 text-emerald-600 hover:bg-emerald-50")} aria-label={`${name}を${active ? "無効化" : "再有効化"}`}><Power className="size-3.5" /><span className="hidden md:inline">{active ? "無効化" : "再有効化"}</span></button></div>;
}

function NfcField({ inputRef, value, scanning, duplicate, onScan, onChange, onDone }: { inputRef: React.RefObject<HTMLInputElement | null>; value: string; scanning: boolean; duplicate?: string; onScan: () => void; onChange: (value: string) => void; onDone: () => void }) {
  return <Field label="NFC UID"><div className={cn("rounded-2xl border p-3", scanning ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-slate-50")}><div className="mb-2 flex items-center justify-between gap-2"><div className="flex items-center gap-2"><Nfc className={cn("size-5", scanning ? "animate-pulse text-blue-600" : "text-slate-400")} /><span className="text-xs font-bold text-slate-600">{scanning ? "タグをかざしてください" : "NFCタグ"}</span></div><button type="button" onClick={onScan} className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-blue-700 shadow-sm">NFC読取</button></div><input ref={inputRef} required className={field} value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onDone(); } }} placeholder="UIDを入力またはタグを読み取り" />{duplicate ? <p className="mt-2 text-xs font-bold text-rose-600">このUIDは「{duplicate}」で登録済みです</p> : scanning ? <p className="mt-2 text-[11px] text-blue-600">リーダーからの入力後、Enterで読み取りを確定します。</p> : null}</div></Field>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-600">{label}</span>{children}</label>; }
