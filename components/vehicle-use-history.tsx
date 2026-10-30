"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, CarFront, ChevronRight, Download, RefreshCw, Search } from "lucide-react";
import { formatHistoryDateTime, formatTripDuration, tripMinutes, vehicleHistoryPeriod, type VehicleHistoryData, type VehicleHistoryVehicle } from "@/lib/vehicle-history";
import { formatFuelLevel } from "@/lib/fuel-level";
import { Button, Card, cn } from "./ui";

// Columns: start, return, duration, fuel, user (the user column takes the remaining width).
const historyColumns = "lg:grid-cols-[150px_150px_100px_100px_minmax(200px,1fr)]";
const field = "min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm";
const emptyFilters = { vehicleId: "", q: "", from: "", to: "" };

export function VehicleUseHistory({ refreshKey = 0 }: { refreshKey?: number }) {
  const [selected, setSelected] = useState<VehicleHistoryVehicle | null>(null);
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [period, setPeriod] = useState<"1" | "3" | "custom">("1");
  const [filters, setFilters] = useState(emptyFilters);
  const [applied, setApplied] = useState(emptyFilters);
  const [data, setData] = useState<VehicleHistoryData | null>(null);
  const [vehicles, setVehicles] = useState<VehicleHistoryVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const appliedRef = useRef(applied);
  appliedRef.current = applied;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  async function load(next?: typeof emptyFilters, page = 1) {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true); setError("");
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    try {
      const params = next ? new URLSearchParams({ ...next, page: String(page) }) : new URLSearchParams({ view: "vehicles" });
      const response = await fetch(`/api/trips/history?${params}`, { cache: "no-store", signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "利用履歴を取得できませんでした");
      if (requestRef.current !== controller) return;
      setVehicles(result.vehicles);
      if (next) { setData(result); setApplied(next); }
    } catch (failure) {
      if (requestRef.current !== controller) return;
      setData(null);
      setError(controller.signal.aborted ? "応答を確認できませんでした。もう一度お試しください。" : (failure as Error).message);
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) setLoading(false);
    }
  }
  useEffect(() => {
    void load(selectedRef.current ? appliedRef.current : undefined);
    return () => { requestRef.current?.abort(); requestRef.current = null; };
  }, [refreshKey]);
  const chooseVehicle = (vehicle: VehicleHistoryVehicle) => {
    const next = { ...emptyFilters, vehicleId: vehicle.id, ...vehicleHistoryPeriod(1) };
    setSelected(vehicle); setPeriod("1"); setFilters(next); setApplied(next); setData(null);
    void load(next);
  };
  const choosePeriod = (value: "1" | "3" | "custom") => {
    setPeriod(value);
    if (value === "custom") return;
    const next = { ...filters, ...vehicleHistoryPeriod(value === "1" ? 1 : 3) };
    setFilters(next); void load(next);
  };
  const downloadCsv = () => {
    const anchor = document.createElement("a");
    anchor.href = `/api/trips/history?${new URLSearchParams({ ...applied, format: "csv" })}`;
    anchor.click();
  };
  const backToVehicles = () => {
    requestRef.current?.abort(); requestRef.current = null;
    setSelected(null); setData(null); setError(""); setLoading(false);
  };
  if (!selected) {
    const search = vehicleSearch.trim().toLocaleLowerCase();
    const matches = vehicles.filter((vehicle) => `${vehicle.name} ${vehicle.vehicleNumber.code} ${vehicle.plateNumber}`.toLocaleLowerCase().includes(search));
    return <Card className="overflow-hidden">
      <div className="space-y-3 border-b border-slate-100 p-4"><div><h3 className="font-black">履歴を確認する車両を選択</h3><p className="mt-1 text-sm text-slate-500">対象車両をクリックし、確認したい期間を選んでください。</p></div><label className="block max-w-md text-xs font-bold text-slate-600">車両を検索<input type="search" value={vehicleSearch} onChange={(event) => setVehicleSearch(event.target.value)} placeholder="車両名・車両番号・ナンバー" className={`${field} mt-1`} /></label></div>
      {error ? <div role="alert" className="m-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}<Button variant="ghost" className="ml-3" disabled={loading} onClick={() => void load()}>再試行</Button></div> : null}
      {loading ? <p role="status" className="p-6 text-sm text-slate-500">車両を読み込み中…</p> : <>
        <p className="px-4 pt-4 text-xs text-slate-500">{matches.length}台 ・ 利用停止した車両の過去の履歴も確認できます。</p>
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">{matches.map((vehicle) => <button type="button" key={vehicle.id} onClick={() => chooseVehicle(vehicle)} className="flex min-h-24 min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-blue-400 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-500"><CarFront className="size-6 shrink-0 text-blue-600" /><span className="min-w-0 flex-1"><span className="block break-words text-sm font-black">{vehicle.name}</span><span className="mt-1 block break-words text-xs text-slate-500">{vehicle.vehicleNumber.code} ・ {vehicle.plateNumber}</span>{!vehicle.active ? <span className="mt-1 block text-xs text-slate-400">利用停止</span> : null}</span><ChevronRight className="size-4 shrink-0 text-slate-400" /></button>)}</div>
        {!matches.length && !error ? <p className="p-6 text-center text-sm text-slate-500">該当する車両はありません</p> : null}
      </>}
    </Card>;
  }
  return <Card className="overflow-hidden">
    <div className="space-y-3 border-b border-slate-100 p-4"><Button variant="ghost" onClick={backToVehicles}><ArrowLeft className="size-4" />車両一覧へ戻る</Button><div><h3 className="text-lg font-black">{selected.name}の利用履歴</h3><p className="mt-1 text-sm text-slate-500">{selected.vehicleNumber.code} ・ {selected.plateNumber}</p></div><div role="group" aria-label="確認する期間" className="flex flex-wrap gap-2">{([{ value: "1", label: "過去1か月" }, { value: "3", label: "過去3か月" }, { value: "custom", label: "期間指定" }] as const).map((item) => <button key={item.value} type="button" aria-pressed={period === item.value} onClick={() => choosePeriod(item.value)} className={cn("min-h-11 rounded-xl border px-4 text-sm font-bold", period === item.value ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}>{item.label}</button>)}</div></div>
    <form data-kiosk-filter-form onSubmit={(event) => { event.preventDefault(); void load(filters); }} className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-3">
      {period === "custom" ? <>
        <label className="min-w-0 text-xs font-bold text-slate-600">開始日時（日本時間）<input type="datetime-local" required value={filters.from} onInput={(event) => { const value = event.currentTarget.value; setFilters((current) => ({ ...current, from: value })); }} className={`${field} mt-1`} /></label>
        <label className="min-w-0 text-xs font-bold text-slate-600">終了日時（日本時間）<input type="datetime-local" required value={filters.to} onInput={(event) => { const value = event.currentTarget.value; setFilters((current) => ({ ...current, to: value })); }} className={`${field} mt-1`} /></label>
      </> : null}
      <label className="text-xs font-bold text-slate-600">利用者名（任意）<input value={filters.q} onChange={(event) => { const value = event.target.value; setFilters((current) => ({ ...current, q: value })); }} placeholder="利用者名で絞り込み" className={`${field} mt-1`} /></label>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-3"><Button type="submit" disabled={loading}>{loading ? <RefreshCw className="size-4 animate-spin" /> : <Search className="size-4" />}{loading ? "読込中" : "検索"}</Button><Button type="button" variant="secondary" onClick={downloadCsv} disabled={loading || !data?.pagination.total}><Download className="size-4" />CSV</Button><p className="text-xs text-slate-500">指定した時間帯と実際の利用時間が重なる記録を表示します。</p></div>
    </form>
    {error ? <p role="alert" className="m-4 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p> : null}
    <div aria-live="polite" aria-busy={loading}>
      {data ? <p className="border-b border-slate-100 px-4 py-3 text-xs font-bold text-slate-500">検索結果：{data.pagination.total}件{loading ? "（更新中）" : ""}<span className="mt-1 block font-normal">対象期間：{applied.from.replace("T", " ")} ～ {applied.to.replace("T", " ")}（日本時間）</span></p> : null}
      <div className={cn("hidden gap-4 bg-slate-50 px-4 py-2 text-xs font-bold text-slate-500 lg:grid", historyColumns)}><span>利用開始</span><span>返却</span><span>利用時間</span><span>ガソリン</span><span>利用者</span></div>
      <div className="divide-y divide-slate-100">{data?.records.map((trip) => {
        const start = formatHistoryDateTime(trip.actualStart);
        const end = trip.status === "COMPLETED" && trip.actualEnd ? formatHistoryDateTime(trip.actualEnd) : null;
        const vehicleNameAtStart = trip.vehicleNameAtStart && trip.vehicleNameAtStart !== selected.name ? trip.vehicleNameAtStart : null;
        return <article key={trip.id} className={cn("grid gap-x-4 gap-y-2 px-4 py-3 transition hover:bg-slate-50 sm:grid-cols-2 lg:items-center", historyColumns)}>
          <div><p className="text-xs font-bold text-slate-500 lg:hidden">利用開始</p><time dateTime={trip.actualStart} className="text-sm tabular-nums">{start}</time></div>
          <div><p className="text-xs font-bold text-slate-500 lg:hidden">返却</p>{end && trip.actualEnd ? <time dateTime={trip.actualEnd} className="text-sm tabular-nums">{end.slice(0, 10) === start.slice(0, 10) ? end.slice(11) : end}</time> : <><span className="inline-block rounded-full bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700">利用中</span><p className="mt-0.5 text-[11px] text-slate-500">返却予定 {formatHistoryDateTime(trip.plannedEnd)}</p></>}</div>
          <div><p className="text-xs font-bold text-slate-500 lg:hidden">利用時間</p><p className="text-sm tabular-nums">{end && trip.actualEnd ? formatTripDuration(tripMinutes(trip.actualStart, trip.actualEnd)) : "—"}</p></div>
          <div><p className="text-xs font-bold text-slate-500 lg:hidden">返却時のガソリン</p><p className="text-sm font-bold text-slate-700">{!end ? "—" : trip.returnFuelLevel === null ? "未記録" : formatFuelLevel(trip.returnFuelLevel)}</p></div>
          <div className="min-w-0"><p className="text-xs font-bold text-slate-500 lg:hidden">利用者</p><p className="text-sm font-bold">{trip.employeeNameAtStart ?? trip.employee.name}<span className="ml-2 text-xs font-normal text-slate-500">{trip.employeeCodeAtStart ?? trip.employee.employeeNumber.code} ・ {trip.departmentNameAtStart ?? trip.employee.department.name}</span></p>{vehicleNameAtStart ? <p className="text-[11px] text-slate-500">当時：{vehicleNameAtStart}</p> : null}{!trip.snapshotCapturedAt ? <p className="text-[11px] text-amber-700">当時の登録情報未保存・現在の情報を表示</p> : null}</div>
        </article>;
      })}</div>
      {!loading && data?.records.length === 0 ? <p className="p-10 text-center text-sm text-slate-500">該当する利用履歴はありません</p> : null}
    </div>
    {data && data.pagination.pageCount > 1 ? <div className="flex items-center justify-center gap-3 border-t border-slate-100 bg-slate-50 p-3"><Button variant="ghost" disabled={loading || data.pagination.page === 1} onClick={() => void load(applied, data.pagination.page - 1)}>前へ</Button><span className="text-xs font-bold">{data.pagination.page} / {data.pagination.pageCount}ページ</span><Button variant="ghost" disabled={loading || data.pagination.page >= data.pagination.pageCount} onClick={() => void load(applied, data.pagination.page + 1)}>次へ</Button></div> : null}
  </Card>;
}
