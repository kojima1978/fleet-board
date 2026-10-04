"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CarFront, Check, Download, FileJson, Nfc, Pencil, Plus, Power, Search, Upload, UserRound, X } from "lucide-react";
import type { DashboardData, Employee, Vehicle } from "@/lib/types";
import { normalizeNfcUid, sameNfcUid } from "@/lib/nfc";
import { nfcBridgeStatusText, useNfcBridge } from "@/lib/use-nfc-bridge";
import { Button, Card, cn } from "./ui";

type Mutate = (body: object, success: string) => Promise<boolean>;
type StatusFilter = "all" | "active" | "inactive" | "inUse";
type ConfirmTarget = { id: string; name: string; active: boolean; version: number };
type ImportRow = Record<string, unknown>;

const emptyEmployee = { code: "", name: "", department: "", nfcUid: "" };
const emptyVehicle = { code: "", name: "", plateNumber: "", nfcUid: "", color: "#2563eb" };
const field = "min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500";
const NFC_SCAN_TIMEOUT_MS = 15_000;

export function SettingsPanelV2({ kind, data, mutate }: { kind: "employee" | "vehicle"; data: DashboardData; mutate: Mutate }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [department, setDepartment] = useState("all");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [employeeForm, setEmployeeForm] = useState(emptyEmployee);
  const [newDepartmentMode, setNewDepartmentMode] = useState(false);
  const [vehicleForm, setVehicleForm] = useState(emptyVehicle);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [highlightId, setHighlightId] = useState("");
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importError, setImportError] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [urlHydrated, setUrlHydrated] = useState(false);
  const nfcInput = useRef<HTMLInputElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const drawerReturnFocus = useRef<HTMLElement | null>(null);

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

  const departments = useMemo(() => data.departments.map((item) => item.name), [data.departments]);
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
  const duplicateNfc = [...data.employees.filter((person) => person.active), ...data.vehicles].find((item) => item.id !== editingId && sameNfcUid(item.nfcUid, currentNfc));

  const employeeDirty = JSON.stringify(employeeForm) !== JSON.stringify(editingEmployee ? { code: editingEmployee.code, name: editingEmployee.name, department: editingEmployee.department, nfcUid: editingEmployee.nfcUid } : emptyEmployee);
  const vehicleDirty = JSON.stringify(vehicleForm) !== JSON.stringify(editingVehicle ? { code: editingVehicle.code, name: editingVehicle.name, plateNumber: editingVehicle.plateNumber, nfcUid: editingVehicle.nfcUid, color: editingVehicle.color } : emptyVehicle);
  const hasUnsavedChanges = drawerOpen && (kind === "employee" ? employeeDirty : vehicleDirty);
  const closeDrawer = useCallback((force = false) => {
    if (!force && drawerOpen && (kind === "employee" ? employeeDirty : vehicleDirty)) { setDiscardConfirm(true); return; }
    setDrawerOpen(false); setEditingEmployee(null); setEditingVehicle(null); setEmployeeForm(emptyEmployee); setVehicleForm(emptyVehicle); setScanning(false); setNewDepartmentMode(false);
  }, [drawerOpen, employeeDirty, kind, vehicleDirty]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!drawerOpen) return;
    drawerReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => {
      const drawer = drawerRef.current;
      const target = drawer?.querySelector<HTMLElement>("input:not([disabled])") ?? drawer?.querySelector<HTMLElement>("select:not([disabled])") ?? drawer?.querySelector<HTMLElement>("button:not([disabled])");
      target?.focus();
    }, 0);
    return () => { window.clearTimeout(timer); drawerReturnFocus.current?.focus(); };
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen && !confirmTarget) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const activeLayer = document.querySelector<HTMLElement>("[role='alertdialog']") ?? drawerRef.current;
      if (event.key === "Escape") {
        event.preventDefault();
        if (submitting) return;
        if (discardConfirm) { setDiscardConfirm(false); return; }
        if (confirmTarget) { setConfirmTarget(null); return; }
        closeDrawer();
        return;
      }
      if (event.key !== "Tab" || !activeLayer) return;
      const focusable = [...activeLayer.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])")];
      if (focusable.length === 0) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeDrawer, confirmTarget, discardConfirm, drawerOpen, submitting]);
  const openCreate = () => { closeDrawer(true); setNewDepartmentMode(kind === "employee" && departments.length === 0); setDrawerOpen(true); };
  const openEmployee = (person: Employee) => {
    setEditingEmployee(person); setEmployeeForm({ code: person.code, name: person.name, department: person.department, nfcUid: person.nfcUid }); setNewDepartmentMode(false); setDrawerOpen(true);
  };
  const openVehicle = (vehicle: Vehicle) => {
    setEditingVehicle(vehicle); setVehicleForm({ code: vehicle.code, name: vehicle.name, plateNumber: vehicle.plateNumber, nfcUid: vehicle.nfcUid, color: vehicle.color }); setDrawerOpen(true);
  };
  const beginNfcScan = () => { setScanning(true); window.setTimeout(() => nfcInput.current?.focus(), 0); };
  const closeImport = () => { if (submitting) return; setImportOpen(false); setImportRows([]); setImportError(""); setImportFileName(""); };
  const readImportFile = async (file?: File) => {
    setImportRows([]); setImportError(""); setImportFileName(file?.name ?? "");
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setImportError("ファイルサイズは2MB以下にしてください"); return; }
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const rows = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>)[kind === "employee" ? "employees" : "vehicles"] : undefined;
      if (!Array.isArray(rows) || rows.length === 0) throw new Error("配列形式のデータがありません");
      if (rows.length > 500) throw new Error("一度に取り込めるのは500件までです");
      const required = kind === "employee" ? ["code", "name", "department", "nfcUid"] : ["code", "name", "plateNumber", "nfcUid"];
      rows.forEach((row, index) => {
        if (!row || typeof row !== "object" || required.some((key) => typeof (row as Record<string, unknown>)[key] !== "string" || !(row as Record<string, string>)[key].trim())) throw new Error(`${index + 1}件目の必須項目を確認してください`);
        if (kind === "vehicle" && "color" in row && (typeof (row as ImportRow).color !== "string" || !/^#[0-9a-fA-F]{6}$/.test((row as ImportRow).color as string))) throw new Error(`${index + 1}件目の表示色は #2563EB の形式で入力してください`);
      });
      setImportRows(rows as ImportRow[]);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "JSONファイルを読み取れませんでした");
    }
  };
  const downloadTemplate = () => {
    const example = kind === "employee" ? [{ code: "E007", name: "山田 太郎", department: "営業部", nfcUid: "04AABBCCDDEEFF" }] : [{ code: "C18", name: "営業車18", plateNumber: "品川 500 あ 12-34", nfcUid: "04AABBCCDDEE11", color: "#2563EB" }];
    const blob = new Blob([JSON.stringify(example, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = kind === "employee" ? "employees-template.json" : "vehicles-template.json"; anchor.click(); URL.revokeObjectURL(url);
  };
  const submitImport = async () => {
    if (submitting || importRows.length === 0) return;
    setSubmitting(true);
    try {
      const items = importRows.map((row) => kind === "employee" ? { code: String(row.code).trim(), name: String(row.name).trim(), department: String(row.department).trim(), nfcUid: normalizeNfcUid(String(row.nfcUid)) } : { code: String(row.code).trim(), name: String(row.name).trim(), plateNumber: String(row.plateNumber).trim(), nfcUid: normalizeNfcUid(String(row.nfcUid)), color: typeof row.color === "string" ? row.color : "#2563eb" });
      const ok = await mutate({ action: kind === "employee" ? "importEmployees" : "importVehicles", items }, `${items.length}${kind === "employee" ? "人" : "台"}をJSONから登録しました`);
      if (ok) { setImportOpen(false); setImportRows([]); setImportError(""); setImportFileName(""); }
    } finally {
      setSubmitting(false);
    }
  };
  const submitEmployee = async (event: React.FormEvent) => {
    event.preventDefault(); if (duplicateNfc) return; setSubmitting(true);
    try {
      const body = editingEmployee ? { action: "updateEmployee", id: editingEmployee.id, version: editingEmployee.version, name: employeeForm.name, department: employeeForm.department, nfcUid: employeeForm.nfcUid } : { action: "createEmployee", ...employeeForm };
      const ok = await mutate(body, editingEmployee ? "社員情報を修正しました" : "社員を登録しました");
      if (ok) { if (editingEmployee) setHighlightId(editingEmployee.id); closeDrawer(true); }
    } finally {
      setSubmitting(false);
    }
  };
  const submitVehicle = async (event: React.FormEvent) => {
    event.preventDefault(); if (duplicateNfc) return; setSubmitting(true);
    try {
      const body = editingVehicle ? { action: "updateVehicle", id: editingVehicle.id, version: editingVehicle.version, name: vehicleForm.name, plateNumber: vehicleForm.plateNumber, nfcUid: vehicleForm.nfcUid, color: vehicleForm.color } : { action: "createVehicle", ...vehicleForm };
      const ok = await mutate(body, editingVehicle ? "車両情報を修正しました" : "車両を登録しました");
      if (ok) { if (editingVehicle) setHighlightId(editingVehicle.id); closeDrawer(true); }
    } finally {
      setSubmitting(false);
    }
  };
  const applyActiveChange = async () => {
    if (!confirmTarget || submitting) return;
    setSubmitting(true);
    try {
      const action = kind === "employee" ? "setEmployeeActive" : "setVehicleActive";
      const ok = await mutate({ action, id: confirmTarget.id, version: confirmTarget.version, active: !confirmTarget.active }, confirmTarget.active ? `${kind === "employee" ? "社員" : "車両"}を無効化しました` : `${kind === "employee" ? "社員" : "車両"}を再有効化しました`);
      if (ok) { setHighlightId(confirmTarget.id); setConfirmTarget(null); }
    } finally {
      setSubmitting(false);
    }
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
          <Button variant="secondary" onClick={() => setImportOpen(true)}><FileJson className="size-4" />JSON取込</Button>
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

    {importOpen ? <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) closeImport(); }}><div role="dialog" aria-modal="true" aria-busy={submitting} aria-label={`${kind === "employee" ? "社員" : "車両"}JSON取込`} className="w-full max-w-2xl rounded-3xl bg-white shadow-2xl"><div className="flex items-start justify-between border-b border-slate-100 p-5"><div><p className="text-xs font-bold text-blue-600">一括登録</p><h2 className="mt-1 text-xl font-black">{kind === "employee" ? "社員情報" : "車両情報"}をJSONから取込</h2><p className="mt-1 text-xs text-slate-500">最大500件。重複や不正がある場合は1件も登録しません。</p></div><button type="button" aria-label="閉じる" disabled={submitting} onClick={closeImport} className="grid size-10 place-items-center rounded-xl bg-slate-100 disabled:opacity-40"><X className="size-4" /></button></div><div className="space-y-4 p-5"><div className="flex flex-wrap gap-2"><label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700"><Upload className="size-4" />JSONファイルを選択<input type="file" accept="application/json,.json" disabled={submitting} className="sr-only" onChange={(event) => void readImportFile(event.target.files?.[0])} /></label><Button type="button" variant="ghost" disabled={submitting} onClick={downloadTemplate}><Download className="size-4" />ひな形を保存</Button></div>{importFileName ? <p className="text-xs font-bold text-slate-600">選択中：{importFileName}</p> : null}{importError ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{importError}</p> : null}{importRows.length > 0 ? <div className="space-y-3"><div className="flex items-center justify-between rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800"><span>{importRows.length}{kind === "employee" ? "人" : "台"}を登録できます</span><Check className="size-5" /></div><div className="max-h-64 overflow-auto rounded-xl border border-slate-200"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-slate-100 text-slate-600"><tr><th className="p-2">番号</th><th className="p-2">名称</th><th className="p-2">{kind === "employee" ? "部署" : "ナンバー"}</th><th className="p-2">NFC UID</th></tr></thead><tbody className="divide-y divide-slate-100">{importRows.slice(0, 20).map((row, index) => <tr key={`${String(row.code)}-${index}`}><td className="p-2 font-bold">{String(row.code)}</td><td className="p-2">{String(row.name)}</td><td className="p-2">{String(kind === "employee" ? row.department : row.plateNumber)}</td><td className="p-2 font-mono text-[10px]">{String(row.nfcUid)}</td></tr>)}</tbody></table></div>{importRows.length > 20 ? <p className="text-center text-xs text-slate-500">先頭20件を表示しています</p> : null}</div> : <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center"><FileJson className="mx-auto size-8 text-slate-300" /><p className="mt-2 text-sm font-bold text-slate-500">JSONファイルを選択してください</p><p className="mt-1 text-xs text-slate-400">配列、または {kind === "employee" ? "employees" : "vehicles"} 配列を含むJSONに対応</p></div>}<div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-4"><Button type="button" variant="ghost" disabled={submitting} onClick={closeImport}>キャンセル</Button><Button type="button" disabled={submitting || importRows.length === 0} onClick={submitImport}>{submitting ? "登録中…" : `${importRows.length}${kind === "employee" ? "人" : "台"}を登録`}</Button></div></div></div></div> : null}

    {drawerOpen ? <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) closeDrawer(); }}><aside ref={drawerRef} role="dialog" aria-modal="true" aria-busy={submitting} aria-label={kind === "employee" ? "社員情報" : "車両情報"} className="ml-auto flex h-full w-full max-w-md flex-col bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-slate-100 p-5"><div><div className="flex items-center gap-2"><p className="text-xs font-bold text-blue-600">{editingEmployee || editingVehicle ? "編集" : "新規登録"}</p>{hasUnsavedChanges && !submitting ? <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700">未保存</span> : null}{submitting ? <span role="status" className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700">保存中</span> : null}</div><h2 className="mt-1 text-xl font-black">{kind === "employee" ? editingEmployee ? "社員情報を編集" : "社員を追加" : editingVehicle ? "車両情報を編集" : "車両を追加"}</h2></div><button aria-label={submitting ? "保存中は閉じられません" : "閉じる"} disabled={submitting} onClick={() => closeDrawer()} className="grid size-10 place-items-center rounded-xl bg-slate-100 transition disabled:cursor-not-allowed disabled:opacity-40"><X className="size-4" /></button></div>
      {kind === "employee" ? <form className="flex flex-1 flex-col overflow-y-auto p-5" onSubmit={submitEmployee}><fieldset disabled={submitting} className="flex min-h-0 min-w-0 flex-1 flex-col border-0 p-0"><div className="space-y-4"><Field label="社員番号"><input required autoFocus={!editingEmployee} disabled={!!editingEmployee} className={field} value={employeeForm.code} onChange={(event) => setEmployeeForm((current) => ({ ...current, code: event.target.value }))} placeholder="例：E007" /></Field><Field label="氏名"><input required autoFocus={!!editingEmployee} className={field} value={employeeForm.name} onChange={(event) => setEmployeeForm((current) => ({ ...current, name: event.target.value }))} placeholder="例：山田 太郎" /></Field><Field label="部署">{newDepartmentMode ? <input required className={field} value={employeeForm.department} onChange={(event) => setEmployeeForm((current) => ({ ...current, department: event.target.value }))} placeholder="新しい部署名" /> : <select required className={field} value={employeeForm.department} onChange={(event) => setEmployeeForm((current) => ({ ...current, department: event.target.value }))}><option value="">部署を選択してください</option>{departments.map((name) => <option key={name} value={name}>{name}</option>)}</select>}<button type="button" onClick={() => { setNewDepartmentMode((current) => !current); setEmployeeForm((current) => ({ ...current, department: "" })); }} className="mt-2 min-h-9 text-xs font-bold text-blue-700 underline decoration-blue-200 underline-offset-4">{newDepartmentMode ? "登録済みの部署から選択" : "新しい部署を登録"}</button></Field><NfcField inputRef={nfcInput} value={employeeForm.nfcUid} scanning={scanning} duplicate={duplicateNfc?.name} onScan={beginNfcScan} onChange={(value) => setEmployeeForm((current) => ({ ...current, nfcUid: value }))} onDone={() => setScanning(false)} /></div><Button type="submit" className="mt-auto w-full" disabled={submitting || !!duplicateNfc}>{submitting ? "保存中…" : editingEmployee ? "変更を保存" : "社員を登録"}</Button></fieldset></form> : <form className="flex flex-1 flex-col overflow-y-auto p-5" onSubmit={submitVehicle}><fieldset disabled={submitting} className="flex min-h-0 min-w-0 flex-1 flex-col border-0 p-0"><div className="space-y-4"><Field label="車両番号"><input required autoFocus={!editingVehicle} disabled={!!editingVehicle} className={field} value={vehicleForm.code} onChange={(event) => setVehicleForm((current) => ({ ...current, code: event.target.value }))} placeholder="例：C09" /></Field><Field label="車両名"><input required autoFocus={!!editingVehicle} className={field} value={vehicleForm.name} onChange={(event) => setVehicleForm((current) => ({ ...current, name: event.target.value }))} placeholder="例：営業車9" /></Field><Field label="ナンバー"><input required className={field} value={vehicleForm.plateNumber} onChange={(event) => setVehicleForm((current) => ({ ...current, plateNumber: event.target.value }))} placeholder="例：品川 500 あ 12-34" /></Field><NfcField inputRef={nfcInput} value={vehicleForm.nfcUid} scanning={scanning} duplicate={duplicateNfc?.name} onScan={beginNfcScan} onChange={(value) => setVehicleForm((current) => ({ ...current, nfcUid: value }))} onDone={() => setScanning(false)} /><Field label="表示色"><span className="flex min-h-11 items-center gap-3 rounded-xl border border-slate-200 px-3"><input aria-label="車両の表示色" type="color" className="h-7 w-10 cursor-pointer border-0 bg-transparent p-0" value={vehicleForm.color} onChange={(event) => setVehicleForm((current) => ({ ...current, color: event.target.value }))} /><span className="text-xs font-bold text-slate-500">{vehicleForm.color.toUpperCase()}</span></span></Field></div><Button type="submit" className="mt-auto w-full" disabled={submitting || !!duplicateNfc}>{submitting ? "保存中…" : editingVehicle ? "変更を保存" : "車両を登録"}</Button></fieldset></form>}
    </aside></div> : null}

    {confirmTarget ? <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm"><div role="alertdialog" aria-modal="true" aria-busy={submitting} className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl"><span className={cn("mx-auto grid size-12 place-items-center rounded-full", confirmTarget.active ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600")}>{confirmTarget.active ? <Power /> : <Check />}</span><h2 className="mt-4 text-center text-lg font-black">{confirmTarget.active ? "無効化しますか？" : "再有効化しますか？"}</h2><p className="mt-2 text-center text-sm text-slate-500">{confirmTarget.name}を{confirmTarget.active ? "利用開始の選択肢から除外します。過去の利用履歴は保持されます。" : "再び利用開始の選択肢へ表示します。"}</p><div className="mt-5 grid grid-cols-2 gap-2"><Button autoFocus variant="ghost" disabled={submitting} onClick={() => setConfirmTarget(null)}>キャンセル</Button><Button disabled={submitting} variant={confirmTarget.active ? "danger" : "primary"} onClick={applyActiveChange}>{submitting ? "処理中…" : confirmTarget.active ? "無効化" : "再有効化"}</Button></div></div></div> : null}
    {discardConfirm ? <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm"><div role="alertdialog" aria-modal="true" className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl"><span className="mx-auto grid size-12 place-items-center rounded-full bg-amber-50 text-amber-600"><X /></span><h2 className="mt-4 text-center text-lg font-black">入力内容を破棄しますか？</h2><p className="mt-2 text-center text-sm text-slate-500">保存していない変更があります。この操作は元に戻せません。</p><div className="mt-5 grid grid-cols-2 gap-2"><Button autoFocus variant="ghost" onClick={() => setDiscardConfirm(false)}>編集を続ける</Button><Button variant="danger" onClick={() => { setDiscardConfirm(false); closeDrawer(true); }}>破棄して閉じる</Button></div></div></div> : null}
  </>;
}

function RowActions({ active, name, onEdit, onActive }: { active: boolean; name: string; onEdit: () => void; onActive: () => void }) {
  return <div className="flex justify-end gap-2"><button type="button" onClick={onEdit} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 hover:bg-slate-50" aria-label={`${name}を編集`}><Pencil className="size-3.5" /><span className="hidden md:inline">編集</span></button><button type="button" onClick={onActive} className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-bold", active ? "border-rose-200 text-rose-600 hover:bg-rose-50" : "border-emerald-200 text-emerald-600 hover:bg-emerald-50")} aria-label={`${name}を${active ? "無効化" : "再有効化"}`}><Power className="size-3.5" /><span className="hidden md:inline">{active ? "無効化" : "再有効化"}</span></button></div>;
}

function NfcField({ inputRef, value, scanning, duplicate, onScan, onChange, onDone }: { inputRef: React.RefObject<HTMLInputElement | null>; value: string; scanning: boolean; duplicate?: string; onScan: () => void; onChange: (value: string) => void; onDone: () => void }) {
  const [timedOut, setTimedOut] = useState(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    if (!scanning) return;
    setTimedOut(false);
    const timer = window.setTimeout(() => { setTimedOut(true); onDoneRef.current(); }, NFC_SCAN_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [scanning]);
  const bridgeStatus = useNfcBridge(scanning, (uid) => { setTimedOut(false); onChange(uid); onDone(); });
  const statusText = nfcBridgeStatusText(bridgeStatus);
  const changeValue = (next: string) => { setTimedOut(false); onChange(next); };
  return <Field label="NFC UID"><div className={cn("rounded-2xl border p-3", scanning ? "border-blue-300 bg-blue-50" : timedOut ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-slate-50")}><div className="mb-2 flex items-center justify-between gap-2"><div className="flex items-center gap-2"><Nfc className={cn("size-5", scanning ? "animate-pulse text-blue-600" : timedOut ? "text-amber-600" : "text-slate-400")} /><span className="text-xs font-bold text-slate-600">{scanning ? "タグをかざしてください" : timedOut ? "読み取りを確認できませんでした" : "NFCタグ"}</span></div><button type="button" onClick={() => { if (scanning) onDone(); else { setTimedOut(false); onScan(); } }} className={cn("shrink-0 rounded-lg bg-white px-3 py-1.5 text-xs font-bold shadow-sm", scanning ? "text-slate-600" : "text-blue-700")}>{scanning ? "読取を停止" : timedOut ? "再試行" : "NFC読取"}</button></div><input ref={inputRef} required className={field} value={value} onChange={(event) => changeValue(event.target.value)} onBlur={() => value && changeValue(normalizeNfcUid(value))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); changeValue(normalizeNfcUid(value)); onDone(); } }} placeholder="UIDを入力またはタグを読み取り" />{duplicate ? <p className="mt-2 text-xs font-bold text-rose-600">このUIDは「{duplicate}」で登録済みです</p> : timedOut ? <p role="status" className="mt-2 text-[11px] font-bold text-amber-800">15秒以内に読み取れませんでした。再試行するか、UIDを手入力してください。</p> : scanning ? <p role="status" aria-live="polite" className={cn("mt-2 text-[11px]", bridgeStatus === "ready" ? "font-bold text-emerald-700" : bridgeStatus === "offline" ? "text-amber-700" : "text-blue-600")}>{statusText}</p> : null}</div></Field>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-600">{label}</span>{children}</label>; }
