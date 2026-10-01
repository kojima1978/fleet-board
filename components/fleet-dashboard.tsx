"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CarFront, Check, ChevronLeft, ChevronRight, Clock3, GripVertical, LayoutGrid, List, LoaderCircle, LogOut, Map as MapIcon, MapPin, Nfc, Pencil, Plus, Power, Printer, RefreshCw, Route, Settings, UserRound, X } from "lucide-react";
import type { DashboardData, Employee, ParkingSpot, Trip, Vehicle } from "@/lib/types";
import { SettingsPanelV2 } from "./settings-panel-v2";
import { Button, Card, cn } from "./ui";

const MINUTES_PER_DAY = 24 * 60;
const DAY_VIEW_START_MINUTE = 6 * 60;
const DAY_VIEW_END_MINUTE = 22 * 60;
const TEMPORARY_SPOT_CODES = new Set(["08", "13", "17", "18"]);
const CUSTOMER_SPOT_CODES = new Set(["01", "02"]);
type Dialog = "start" | "end" | "parkingReturn" | "moveVehicle" | "edit" | "nfc" | null;
type DashboardView = "parking" | "timeline" | "operations" | "settingsEmployees" | "settingsVehicles";
type StartContext = { vehicleId: string; employeeId: string };
const jpTime = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false });
const jpDate = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "long", day: "numeric", weekday: "long" });
const jpShortDate = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", weekday: "short" });
const jpDateTime = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const formatTime = (value: string | Date) => jpTime.format(new Date(value));
const formatDateTime = (value: string | Date) => jpDateTime.format(new Date(value));
const formatPlateShort = (value: string) => {
  const parts = value.trim().split(/\s+/);
  return parts[parts.length - 1] || value;
};
const formatSpotLabel = (code: string) => CUSTOMER_SPOT_CODES.has(code) ? `区画 ${code}（お客様用）` : TEMPORARY_SPOT_CODES.has(code) ? `区画 ${code}（臨時）` : `区画 ${code}`;
const tokyoDayStart = (value = new Date()) => {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
  return new Date(`${day}T00:00:00+09:00`);
};

export function FleetDashboard({ view }: { view: DashboardView }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [returnTrip, setReturnTrip] = useState<Trip | null>(null);
  const [returnSpot, setReturnSpot] = useState<ParkingSpot | null>(null);
  const [movingVehicle, setMovingVehicle] = useState<Vehicle | null>(null);
  const [editTrip, setEditTrip] = useState<Trip | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState(false);
  const pendingRef = useRef(false);
  const [parkingMode, setParkingMode] = useState<"map" | "list">("map");
  const [timelineMode, setTimelineMode] = useState<"chart" | "list">("chart");
  const [changedVehicleIds, setChangedVehicleIds] = useState<string[]>([]);
  const vehicleVersions = useRef(new Map<string, number>());
  const [startContext, setStartContext] = useState<StartContext | null>(null);
  const [timelineDate, setTimelineDate] = useState(() => tokyoDayStart());
  const [timelineDays, setTimelineDays] = useState<1 | 3>(1);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const query = view === "timeline" ? `?from=${encodeURIComponent(timelineDate.toISOString())}&days=${timelineDays}` : "";
      const response = await fetch(`/api/dashboard${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const next = await response.json() as DashboardData;
      if (quiet && vehicleVersions.current.size > 0) {
        const changed = next.vehicles.filter((vehicle) => vehicleVersions.current.get(vehicle.id) !== vehicle.version).map((vehicle) => vehicle.id);
        if (changed.length > 0) {
          setChangedVehicleIds(changed);
          window.setTimeout(() => setChangedVehicleIds([]), 2200);
        }
      }
      vehicleVersions.current = new Map(next.vehicles.map((vehicle) => [vehicle.id, vehicle.version]));
      setData(next);
    } catch { setToast({ message: "データベースに接続できませんでした", tone: "error" }); }
    finally { if (!quiet) setLoading(false); }
  }, [timelineDate, timelineDays, view]);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load(true), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!data) return;
    const employeeId = window.sessionStorage.getItem("fleetflow.employeeId");
    const saved = data.employees.find((person) => person.id === employeeId && person.active) ?? null;
    setEmployee(saved);
    if (!saved && employeeId) window.sessionStorage.removeItem("fleetflow.employeeId");
  }, [data?.employees]);

  useEffect(() => {
    if (view !== "timeline") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("started") !== "1") return;
    setStartContext({ vehicleId: params.get("vehicleId") ?? "", employeeId: params.get("employeeId") ?? "" });
    window.history.replaceState({}, "", "/timeline");
  }, [view]);

  const mutate = useCallback(async (body: object, success: string) => {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPendingAction(true);
    try {
      const response = await fetch("/api/dashboard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      setToast({ message: response.ok ? success : result.message, tone: response.ok ? "success" : "error" });
      await load(true);
      return response.ok;
    } catch {
      setToast({ message: "通信に失敗しました。接続を確認して再試行してください", tone: "error" });
      return false;
    } finally {
      pendingRef.current = false;
      setPendingAction(false);
    }
  }, [load]);

  if (loading || !data) return <Loading />;
  const activeTrips = data.trips.filter((trip) => trip.status === "IN_USE");
  const activeEmployees = data.employees.filter((person) => person.active);
  const activeVehicles = data.vehicles.filter((vehicle) => vehicle.active);
  const available = activeVehicles.filter((vehicle) => vehicle.status === "AVAILABLE");
  const parkingSummary = data.spots.reduce((summary, spot) => {
    if (spot.vehicle) summary.parked += 1;
    else if (TEMPORARY_SPOT_CODES.has(spot.code)) summary.temporaryAvailable += 1;
    else summary.regularAvailable += 1;
    return summary;
  }, { parked: 0, regularAvailable: 0, temporaryAvailable: 0 });
  const confirmedTrip = startContext ? data.trips.find((trip) => trip.vehicleId === startContext.vehicleId && trip.employeeId === startContext.employeeId && trip.status === "IN_USE") : undefined;
  const openStart = (vehicle?: Vehicle) => { setSelectedVehicleId(vehicle?.id ?? ""); setDialog("start"); };
  const openEnd = (trip: Trip) => { setReturnTrip(trip); setDialog("end"); };
  const openParkingReturn = (spot: ParkingSpot) => { setReturnSpot(spot); setDialog("parkingReturn"); };
  const openMoveVehicle = (vehicle: Vehicle) => { setMovingVehicle(vehicle); setDialog("moveVehicle"); };
  const openEdit = (trip: Trip) => { setEditTrip(trip); setDialog("edit"); };
  const completeReturn = async (trip: Trip, spotId: string) => {
    const currentVehicle = data.vehicles.find((vehicle) => vehicle.id === trip.vehicleId);
    if (!currentVehicle) return false;
    return mutate({ action: "end", tripId: trip.id, tripVersion: trip.version, vehicleId: trip.vehicleId, vehicleVersion: currentVehicle.version, spotId, actorName: employee?.name ?? "共用端末" }, "返却を登録しました。車両は利用可能です");
  };
  const selectEmployee = (person: Employee) => {
    setEmployee(person);
    window.sessionStorage.setItem("fleetflow.employeeId", person.id);
  };
  const clearEmployee = () => {
    setEmployee(null);
    window.sessionStorage.removeItem("fleetflow.employeeId");
    setToast({ message: "利用者の選択を解除しました", tone: "success" });
  };

  return (
    <div className="min-h-screen bg-[#f4f7fb] text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-5 px-4 py-3 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-11 place-items-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-200"><CarFront /></div>
            <div className="min-w-0 max-[360px]:hidden"><h1 className="text-lg font-black tracking-tight">FleetFlow</h1><p className="hidden text-xs text-slate-500 sm:block">社用車 利用・駐車管理</p></div>
          </div>
          <Navigation view={view} className="hidden md:flex" />
          <div className="flex items-center gap-2">
            {employee ? <button onClick={clearEmployee} title="クリックして利用者選択を解除" className="hidden items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800 lg:flex"><UserRound className="size-4" /><span>{employee.name}</span><X className="size-3.5" /></button> : <div className="hidden items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800 lg:flex"><AlertTriangle className="size-4" /><span>利用者未選択</span></div>}
            <Button variant="ghost" onClick={() => setDialog("nfc")}><Nfc className="size-5" /><span className="hidden sm:inline">NFC読取</span></Button>
            <button aria-label="更新" onClick={() => load()} className="grid size-11 place-items-center rounded-xl border border-slate-200 bg-white"><RefreshCw className="size-4" /></button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] space-y-5 p-4 pb-28 md:p-8">
        {view === "parking" ? <section className="space-y-3 md:-mt-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm md:px-4">
            <div className="mr-auto min-w-64"><h2 className="text-sm font-black">{parkingMode === "map" ? "社屋隣接駐車場 配置図" : "駐車区画一覧"}</h2><p className="text-[11px] text-slate-500">{parkingMode === "map" ? "駐車中の車をタップして利用開始 ・ 空き区画をタップして返却" : "すべての区画を一覧で確認・操作できます"}</p></div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold"><SummaryPill color="emerald" label={`通常空き ${parkingSummary.regularAvailable}区画`} /><SummaryPill color="amber" label={`臨時空き ${parkingSummary.temporaryAvailable}区画`} /><SummaryPill color="rose" label={`駐車中 ${parkingSummary.parked}台`} /><span className="px-1 text-slate-500">{jpDate.format(new Date())} ・ 5秒ごとに更新</span></div>
            <div className="flex flex-wrap items-center gap-3 text-xs"><Legend color="bg-emerald-500" label="通常空き" /><Legend color="bg-amber-500" label="臨時駐車可" /><Legend color="bg-rose-500" label="駐車中" /></div>
            <ViewSwitch value={parkingMode} onChange={setParkingMode} first={{ value: "map", label: "配置図", icon: <MapIcon className="size-4" /> }} second={{ value: "list", label: "一覧", icon: <List className="size-4" /> }} compact />
          </div>
          {parkingMode === "map" ? <ParkingMap data={data} changedVehicleIds={changedVehicleIds} mutate={mutate} openStart={openStart} openReturn={openParkingReturn} openMove={openMoveVehicle} actorName={employee?.name ?? "共用端末"} /> : <ParkingList data={data} changedVehicleIds={changedVehicleIds} openStart={openStart} openReturn={openParkingReturn} openMove={openMoveVehicle} />}
        </section> : null}

        {view === "timeline" ? <>
          {startContext ? <Card className="flex flex-wrap items-center gap-3 border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-emerald-600 text-white"><Check className="size-5" /></span>
            <div className="min-w-0 flex-1"><p className="font-black">利用開始を登録しました</p><p className="mt-0.5 text-sm text-emerald-700">{confirmedTrip ? `${confirmedTrip.vehicle.name} ・ ${confirmedTrip.employee.name} ・ ${formatDateTime(confirmedTrip.plannedStart)}〜${formatDateTime(confirmedTrip.plannedEnd)}` : "登録内容がタイムラインに反映されています。"}</p></div>
            <Link href="/" className="rounded-xl border border-emerald-300 bg-white px-4 py-2 text-sm font-bold text-emerald-800 transition hover:bg-emerald-100">駐車場へ戻る</Link>
          </Card> : null}
          <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            {timelineMode === "chart" ? <Card className="min-w-0 overflow-hidden"><TimelinePanelHeader mode={timelineMode} onChange={setTimelineMode} /><Timeline data={data} mutate={mutate} openStart={openStart} openEdit={openEdit} actorName={employee?.name ?? "共用端末"} highlightTripId={confirmedTrip?.id} timelineDate={timelineDate} timelineDays={timelineDays} setTimelineDate={setTimelineDate} setTimelineDays={setTimelineDays} /></Card> : <TimelineList trips={data.trips} openEdit={openEdit} mode={timelineMode} onChange={setTimelineMode} />}
            <ActiveTripsPanel trips={activeTrips} openEnd={openEnd} />
          </section>
        </> : null}

        {view === "operations" ? <>
          <PageHeading eyebrow="貸出・返却手続き" title="利用・返却" description="NFCタグを読み取り、車両の利用開始または返却を登録します。" />
          <section className="grid gap-3 sm:grid-cols-3">
            <StatusCard icon={<Check />} label="利用可能" value={`${available.length}台`} sub="タップして利用開始" color="emerald" onClick={() => openStart()} />
            <StatusCard icon={<Route />} label="利用中" value={`${activeTrips.length}台`} sub="現在外出中" color="blue" />
            <Card className="flex items-center gap-4 p-5"><div className="grid size-12 place-items-center rounded-2xl bg-violet-50 text-violet-600"><Nfc /></div><div><p className="text-xs font-bold text-slate-500">NFC</p><button onClick={() => setDialog("nfc")} className="mt-1 text-left font-black text-violet-700">タグを読み取る</button></div></Card>
          </section>
          <section className="grid gap-5 lg:grid-cols-2">
            <Card className="p-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="font-black">利用可能な車両</h2><p className="text-xs text-slate-500">車両を選んで利用開始</p></div><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">{available.length}台</span></div><div className="grid gap-2 sm:grid-cols-2">{available.map((vehicle) => <button key={vehicle.id} onClick={() => openStart(vehicle)} className="flex min-h-16 items-center gap-3 rounded-xl border border-slate-200 p-3 text-left transition hover:border-blue-400 hover:bg-blue-50"><span className="grid size-10 place-items-center rounded-xl bg-slate-100"><CarFront className="size-5" style={{ color: vehicle.color }} /></span><span><b className="block text-sm">{vehicle.name}</b><small className="text-slate-400">{vehicle.plateNumber}</small></span><ChevronRight className="ml-auto size-4 text-slate-300" /></button>)}</div></Card>
            <ActiveTripsPanel trips={activeTrips} openEnd={openEnd} />
          </section>
        </> : null}

        {view === "settingsEmployees" || view === "settingsVehicles" ? <>
          <PageHeading eyebrow="管理設定" title={view === "settingsEmployees" ? "社員登録" : "車両登録"} description={view === "settingsEmployees" ? "利用者となる社員と社員証のNFCタグを登録します。" : "利用する社用車と車両のNFCタグを登録します。"} />
          <SettingsNavigation view={view} />
          <EmergencyPrintPanel />
          <SettingsPanelV2 kind={view === "settingsEmployees" ? "employee" : "vehicle"} data={data} mutate={mutate} />
        </> : null}
      </main>

      {dialog === "nfc" && <NfcDialog employees={activeEmployees} vehicles={activeVehicles} onEmployee={(person) => { selectEmployee(person); setToast({ message: `${person.name}さんを認証しました`, tone: "success" }); setDialog(null); }} onVehicle={(vehicle) => { setDialog(null); const trip = activeTrips.find((item) => item.vehicleId === vehicle.id); if (trip) openEnd(trip); else openStart(vehicle); }} onClose={() => setDialog(null)} />}
      {dialog === "start" && <StartDialog submitting={pendingAction} employees={activeEmployees} vehicles={available} initialEmployee={employee?.active ? employee : null} initialVehicleId={selectedVehicleId} onClose={() => setDialog(null)} onSubmit={async (values) => { const identifiedEmployee = activeEmployees.find((person) => person.id === values.employeeId) ?? null; const ok = await mutate({ action: "start", employeeId: values.employeeId, vehicleId: values.vehicleId, minutes: values.minutes, actorName: values.employeeName }, "利用を開始しました"); if (ok && identifiedEmployee) { selectEmployee(identifiedEmployee); setDialog(null); if (view === "parking") window.location.assign(`/timeline?started=1&vehicleId=${encodeURIComponent(values.vehicleId)}&employeeId=${encodeURIComponent(values.employeeId)}`); } }} />}
      {dialog === "end" && returnTrip && <EndDialog submitting={pendingAction} trip={returnTrip} spots={data.spots} onClose={() => setDialog(null)} onSubmit={async (spotId) => { const ok = await completeReturn(returnTrip, spotId); if (ok) setDialog(null); }} />}
      {dialog === "parkingReturn" && returnSpot && <ParkingReturnDialog submitting={pendingAction} spot={returnSpot} trips={activeTrips} onClose={() => setDialog(null)} onSubmit={async (trip) => { const ok = await completeReturn(trip, returnSpot.id); if (ok) { setDialog(null); setReturnSpot(null); } }} />}
      {dialog === "moveVehicle" && movingVehicle && <MoveVehicleDialog submitting={pendingAction} vehicle={movingVehicle} spots={data.spots} onClose={() => setDialog(null)} onSubmit={async (spotId) => { const spot = data.spots.find((item) => item.id === spotId); const ok = await mutate({ action: "moveVehicle", vehicleId: movingVehicle.id, version: movingVehicle.version, spotId, actorName: employee?.name ?? "共用端末" }, `区画${spot?.code ?? ""}へ移動しました`); if (ok) setDialog(null); }} />}
      {dialog === "edit" && editTrip && <EditTripDialog submitting={pendingAction} trip={editTrip} onClose={() => setDialog(null)} onAdjust={async (minutes) => { const direction = minutes > 0 ? "延長" : "短縮"; const ok = await mutate({ action: "adjustTrip", tripId: editTrip.id, version: editTrip.version, minutes, actorName: employee?.name ?? "共用端末" }, `${Math.abs(minutes)}分${direction}しました`); if (ok) setDialog(null); }} onCancel={async () => { const ok = await mutate({ action: "cancelTrip", tripId: editTrip.id, version: editTrip.version, actorName: employee?.name ?? "共用端末" }, "予約を取り消しました"); if (ok) setDialog(null); }} />}
      {pendingAction ? <div className="fixed left-0 top-0 z-[80] h-1 w-full overflow-hidden bg-blue-100"><div className="h-full w-1/2 animate-pulse bg-blue-600" /></div> : null}
      {toast ? <div role={toast.tone === "error" ? "alert" : "status"} className={cn("fixed bottom-24 left-1/2 z-[70] flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white shadow-2xl md:bottom-5", toast.tone === "error" ? "bg-rose-700" : "bg-slate-950")} onAnimationEnd={() => toast.tone === "success" && setToast(null)}>{toast.tone === "error" ? <AlertTriangle className="size-4 shrink-0" /> : <Check className="size-4 shrink-0" />}<span>{toast.message}</span>{toast.tone === "error" ? <button type="button" aria-label="エラー通知を閉じる" onClick={() => setToast(null)} className="ml-1 grid size-7 shrink-0 place-items-center rounded-lg bg-white/15 hover:bg-white/25"><X className="size-3.5" /></button> : null}</div> : null}
      <Navigation view={view} className="fixed inset-x-3 bottom-3 z-40 flex rounded-2xl border border-slate-200 bg-white/95 p-1.5 shadow-2xl backdrop-blur md:hidden" />
    </div>
  );
}

function Loading() { return <div className="min-h-screen bg-[#f4f7fb]"><header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-3 md:px-8"><div className="grid size-11 place-items-center rounded-2xl bg-blue-600 text-white"><CarFront /></div><div><p className="text-lg font-black">FleetFlow</p><p className="text-xs text-slate-500">社用車 利用・駐車管理</p></div></div></header><main className="mx-auto max-w-[1600px] space-y-5 p-4 md:p-8"><div className="h-7 w-52 animate-pulse rounded-lg bg-slate-200" /><div className="grid gap-3 sm:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}</div><div className="grid min-h-64 place-items-center rounded-2xl border border-slate-200 bg-white"><div className="text-center"><RefreshCw className="mx-auto size-8 animate-spin text-blue-600" /><p className="mt-3 text-sm font-bold text-slate-600">車両情報を読み込み中</p></div></div></main></div>; }

function Navigation({ view, className }: { view: DashboardView; className?: string }) {
  const links: { id: "parking" | "timeline" | "operations" | "settings"; href: string; label: string; icon: React.ReactNode }[] = [
    { id: "parking", href: "/", label: "駐車場", icon: <LayoutGrid className="size-4" /> },
    { id: "timeline", href: "/timeline", label: "タイムライン", icon: <Clock3 className="size-4" /> },
    { id: "operations", href: "/operations", label: "利用・返却", icon: <Route className="size-4" /> },
    { id: "settings", href: "/settings/employees", label: "設定", icon: <Settings className="size-4" /> },
  ];
  return <nav aria-label="メインメニュー" className={cn("items-center justify-center gap-1", className)}>{links.map((link) => { const active = link.id === "settings" ? view.startsWith("settings") : view === link.id; return <Link key={link.id} href={link.href} aria-current={active ? "page" : undefined} className={cn("flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 whitespace-nowrap rounded-xl px-1 text-[10px] font-bold transition md:min-h-10 md:flex-none md:flex-row md:gap-2 md:px-4 md:text-xs", active ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900")}>{link.icon}<span className="max-w-full truncate max-[300px]:hidden">{link.label}</span></Link>; })}</nav>;
}

function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div><p className="text-xs font-bold text-blue-600">{eyebrow}</p><h2 className="mt-1 text-2xl font-black">{title}</h2><p className="mt-1 text-sm text-slate-500">{description}</p></div>;
}

function SummaryPill({ color, label }: { color: "emerald" | "amber" | "rose"; label: string }) {
  const colors = { emerald: "bg-emerald-100 text-emerald-700", amber: "bg-amber-100 text-amber-800", rose: "bg-rose-100 text-rose-700" };
  return <span className={cn("rounded-full px-2.5 py-1", colors[color])}>{label}</span>;
}

function ActiveTripsPanel({ trips, openEnd }: { trips: Trip[]; openEnd: (trip: Trip) => void }) {
  return <Card className="p-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="font-black">利用中</h2><p className="text-xs text-slate-500">返却すると即時利用可能になります</p></div><span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">{trips.length}件</span></div><div className="space-y-3">{trips.length === 0 ? <Empty label="現在利用中の車両はありません。利用開始は左の一覧またはNFCから登録できます" /> : trips.map((trip) => { const overdue = new Date(trip.plannedEnd).getTime() < Date.now(); return <div key={trip.id} className={cn("rounded-2xl border p-4", overdue ? "border-rose-300 bg-rose-50/50" : "border-slate-200")}><div className="flex items-start justify-between"><div><p className="font-black">{trip.vehicle.name}</p><p className="mt-0.5 text-xs text-slate-500">{trip.employee.name} ・ {trip.employee.department}</p></div><span className={cn("rounded-full px-2 py-1 text-[10px] font-bold", overdue ? "bg-rose-100 text-rose-700" : "bg-blue-50 text-blue-700")}>{overdue ? "返却超過" : "利用中"}</span></div><div className={cn("my-3 flex items-center gap-2 text-xs", overdue ? "font-bold text-rose-700" : "text-slate-600")}><Clock3 className="size-4" />返却予定 {formatDateTime(trip.plannedEnd)}</div><Button className="w-full" variant="secondary" onClick={() => openEnd(trip)}><LogOut className="size-4" />返却登録</Button></div>; })}</div></Card>;
}

function StatusCard({ icon, label, value, sub, color, onClick }: { icon: React.ReactNode; label: string; value: string; sub: string; color: "emerald" | "blue" | "amber"; onClick?: () => void }) {
  const colors = { emerald: "bg-emerald-50 text-emerald-600", blue: "bg-blue-50 text-blue-600", amber: "bg-amber-50 text-amber-600" };
  const content = <><div className={cn("grid size-12 place-items-center rounded-2xl", colors[color])}>{icon}</div><div className="text-left"><p className="text-xs font-bold text-slate-500">{label}</p><p className="text-2xl font-black">{value}</p><p className="text-xs text-slate-400">{sub}</p></div>{onClick ? <ChevronRight className="ml-auto text-slate-300" /> : null}</>;
  return onClick ? <button type="button" onClick={onClick} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-4 focus:ring-blue-100">{content}</button> : <Card className="flex items-center gap-4 p-5">{content}</Card>;
}
function Legend({ color, label }: { color: string; label: string }) { return <span className="flex items-center gap-1.5"><i className={cn("size-2 rounded-full", color)} />{label}</span>; }
function Empty({ label }: { label: string }) { return <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-400">{label}</div>; }

function ViewSwitch<T extends string>({ value, onChange, first, second, compact = false }: { value: T; onChange: (value: T) => void; first: { value: T; label: string; icon: React.ReactNode }; second: { value: T; label: string; icon: React.ReactNode }; compact?: boolean }) {
  return <div className="inline-flex w-fit rounded-xl border border-slate-200 bg-white p-1 shadow-sm">{[first, second].map((item) => <button key={item.value} type="button" onClick={() => onChange(item.value)} aria-pressed={value === item.value} className={cn("inline-flex items-center gap-2 rounded-lg font-bold transition", compact ? "min-h-7 px-2.5 text-xs" : "min-h-10 px-4 text-sm", value === item.value ? "bg-slate-900 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50")} >{item.icon}{item.label}</button>)}</div>;
}

function TimelinePanelHeader({ mode, onChange }: { mode: "chart" | "list"; onChange: (mode: "chart" | "list") => void }) {
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-100 px-4 py-2.5"><ViewSwitch value={mode} onChange={onChange} first={{ value: "chart", label: "タイムライン", icon: <Clock3 className="size-4" /> }} second={{ value: "list", label: "予定一覧", icon: <List className="size-4" /> }} compact /><p className="mr-auto text-xs text-slate-500">{mode === "chart" ? "ドラッグまたは予定をタップして時間を変更" : "予定を選ぶと終了時間の変更や取消ができます"}</p><div className="flex shrink-0 gap-3 text-xs"><Legend color="bg-blue-500" label="利用中" /><Legend color="bg-violet-500" label="予約" /><Legend color="bg-slate-400" label="完了" /></div></div>;
}

function ParkingList({ data, changedVehicleIds, openStart, openReturn, openMove }: { data: DashboardData; changedVehicleIds: string[]; openStart: (vehicle?: Vehicle) => void; openReturn: (spot: ParkingSpot) => void; openMove: (vehicle: Vehicle) => void }) {
  return <Card className="overflow-hidden"><div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">{data.spots.map((spot) => <div key={spot.id} className={cn("flex min-h-32 flex-col rounded-xl border border-slate-200 bg-white p-3 transition", spot.vehicle && changedVehicleIds.includes(spot.vehicle.id) && "border-amber-300 bg-amber-50 ring-2 ring-amber-300")}><div className="flex items-center gap-3"><span className={cn("grid size-11 shrink-0 place-items-center rounded-xl text-sm font-black leading-none", spot.vehicle ? "bg-rose-50 text-rose-700" : TEMPORARY_SPOT_CODES.has(spot.code) ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700")}><b>{spot.code}</b>{CUSTOMER_SPOT_CODES.has(spot.code) ? <small className="text-[8px]">お客様用</small> : TEMPORARY_SPOT_CODES.has(spot.code) ? <small className="text-[8px]">臨時</small> : null}</span><div className="min-w-0 flex-1">{spot.vehicle ? <><p className="truncate text-sm font-black">{spot.vehicle.name}</p><p className="truncate text-xs text-slate-500">{spot.vehicle.plateNumber} ・ {spot.vehicle.code}{TEMPORARY_SPOT_CODES.has(spot.code) ? " ・ 臨時駐車中" : ""}</p></> : <><p className={cn("text-sm font-black", TEMPORARY_SPOT_CODES.has(spot.code) ? "text-amber-800" : "text-emerald-700")}>{CUSTOMER_SPOT_CODES.has(spot.code) ? "お客様用・空き区画" : TEMPORARY_SPOT_CODES.has(spot.code) ? "臨時駐車スペース" : "空き区画"}</p><p className="text-xs text-slate-500">{TEMPORARY_SPOT_CODES.has(spot.code) ? "通常区画ではありませんが駐車できます" : "社用車の返却先としても選択できます"}</p></>}</div></div><div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">{spot.vehicle ? <><Button variant="ghost" className="min-h-9 flex-1 px-3" onClick={() => openMove(spot.vehicle!)}><MapPin className="size-4" />移動</Button><Button className="min-h-9 flex-1 px-3" onClick={() => openStart(spot.vehicle!)}>利用開始</Button></> : <Button variant="secondary" className="min-h-9 w-full px-3" onClick={() => openReturn(spot)}>この区画へ返却</Button>}</div></div>)}</div></Card>;
}

function TimelineList({ trips, openEdit, mode, onChange }: { trips: Trip[]; openEdit: (trip: Trip) => void; mode: "chart" | "list"; onChange: (mode: "chart" | "list") => void }) {
  const ordered = [...trips].sort((left, right) => new Date(left.plannedStart).getTime() - new Date(right.plannedStart).getTime());
  const now = Date.now();
  return <Card className="overflow-hidden"><TimelinePanelHeader mode={mode} onChange={onChange} />{ordered.length === 0 ? <div className="p-5"><Empty label="この期間の利用予定はありません" /></div> : <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">{ordered.map((trip) => {
    const overdue = trip.status === "IN_USE" && new Date(trip.plannedEnd).getTime() < now;
    const label = trip.status === "IN_USE" ? overdue ? "返却超過" : "利用中" : trip.status === "RESERVED" ? "予約" : "完了";
    return <button key={trip.id} type="button" disabled={trip.status === "COMPLETED"} onClick={() => openEdit(trip)} className="min-h-28 rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-blue-300 hover:bg-blue-50/40 hover:shadow-sm disabled:cursor-default disabled:hover:border-slate-200 disabled:hover:bg-white disabled:hover:shadow-none"><span className="flex items-start gap-2"><span className={cn("mt-1 size-2.5 shrink-0 rounded-full", overdue ? "bg-rose-500" : trip.status === "IN_USE" ? "bg-blue-500" : trip.status === "RESERVED" ? "bg-violet-500" : "bg-slate-300")} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-black">{trip.vehicle.name}</span><span className="mt-0.5 block truncate text-xs text-slate-500">{trip.employee.name}</span></span><span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-bold", overdue ? "bg-rose-100 text-rose-700" : trip.status === "IN_USE" ? "bg-blue-50 text-blue-700" : trip.status === "RESERVED" ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-500")}>{label}</span>{trip.status !== "COMPLETED" ? <ChevronRight className="mt-1 size-4 shrink-0 text-slate-300" /> : null}</span><span className="mt-3 block border-t border-slate-100 pt-2 text-xs font-bold text-slate-600">{formatDateTime(trip.plannedStart)}〜{formatDateTime(trip.plannedEnd)}</span></button>;
  })}</div>}</Card>;
}

function SettingsNavigation({ view }: { view: "settingsEmployees" | "settingsVehicles" }) {
  return <nav aria-label="設定メニュー" className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm"><Link href="/settings/employees" className={cn("rounded-lg px-5 py-2 text-sm font-bold transition", view === "settingsEmployees" ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50")}>社員登録</Link><Link href="/settings/vehicles" className={cn("rounded-lg px-5 py-2 text-sm font-bold transition", view === "settingsVehicles" ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50")}>車両登録</Link></nav>;
}

function EmergencyPrintPanel() {
  return <Card className="flex flex-wrap items-center gap-3 border-amber-200 bg-amber-50/60 p-4"><div className="mr-auto min-w-64"><p className="flex items-center gap-2 font-black text-amber-950"><Printer className="size-5" />緊急時印刷</p><p className="mt-0.5 text-xs text-amber-800">障害時に手書きで運用できる、日付・予定・駐車位置が空欄のA4横用紙です。</p></div><Link href="/print/parking?print=1" target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-amber-300 bg-white px-4 text-sm font-bold text-amber-900 shadow-sm transition hover:bg-amber-100"><MapIcon className="size-4" />空白の配置図を印刷</Link><Link href="/print/timeline?print=1" target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800"><Clock3 className="size-4" />空白のタイムラインを印刷</Link></Card>;
}

function SettingsPanel({ kind, data, mutate }: { kind: "employee" | "vehicle"; data: DashboardData; mutate: (body: object, success: string) => Promise<boolean> }) {
  const [employeeForm, setEmployeeForm] = useState({ code: "", name: "", department: "", nfcUid: "" });
  const [vehicleForm, setVehicleForm] = useState({ code: "", name: "", plateNumber: "", nfcUid: "", color: "#2563eb" });
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [submitting, setSubmitting] = useState<"employee" | "vehicle" | null>(null);
  const updateEmployee = (key: keyof typeof employeeForm, value: string) => setEmployeeForm((current) => ({ ...current, [key]: value }));
  const updateVehicle = (key: keyof typeof vehicleForm, value: string) => setVehicleForm((current) => ({ ...current, [key]: value }));
  const submitEmployee = async (event: React.FormEvent) => {
    event.preventDefault(); setSubmitting("employee");
    const body = editingEmployee ? { action: "updateEmployee", id: editingEmployee.id, version: editingEmployee.version, name: employeeForm.name, department: employeeForm.department, nfcUid: employeeForm.nfcUid } : { action: "createEmployee", ...employeeForm };
    const ok = await mutate(body, editingEmployee ? "社員情報を修正しました" : "社員を登録しました");
    if (ok) { setEmployeeForm({ code: "", name: "", department: "", nfcUid: "" }); setEditingEmployee(null); }
    setSubmitting(null);
  };
  const submitVehicle = async (event: React.FormEvent) => {
    event.preventDefault(); setSubmitting("vehicle");
    const body = editingVehicle ? { action: "updateVehicle", id: editingVehicle.id, version: editingVehicle.version, name: vehicleForm.name, plateNumber: vehicleForm.plateNumber, nfcUid: vehicleForm.nfcUid, color: vehicleForm.color } : { action: "createVehicle", ...vehicleForm };
    const ok = await mutate(body, editingVehicle ? "車両情報を修正しました" : "車両を登録しました");
    if (ok) { setVehicleForm({ code: "", name: "", plateNumber: "", nfcUid: "", color: "#2563eb" }); setEditingVehicle(null); }
    setSubmitting(null);
  };
  return <section className="max-w-4xl">
    {kind === "employee" ? <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 p-5"><div><h2 className="font-black">{editingEmployee ? "社員情報を修正" : "社員を登録"}</h2><p className="mt-1 text-xs text-slate-500">無効化しても過去の利用履歴は保持されます</p></div><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">有効 {data.employees.filter((person) => person.active).length} / {data.employees.length}人</span></div>
      <form className="grid gap-3 border-b border-slate-100 bg-slate-50/60 p-5 sm:grid-cols-2" onSubmit={submitEmployee}>
        <Label text="社員番号"><input required disabled={!!editingEmployee} autoComplete="off" className={cn(compactField, editingEmployee && "cursor-not-allowed bg-slate-100 text-slate-500")} value={employeeForm.code} onChange={(event) => updateEmployee("code", event.target.value)} placeholder="例：001" /></Label>
        <Label text="氏名"><input required autoComplete="off" className={compactField} value={employeeForm.name} onChange={(event) => updateEmployee("name", event.target.value)} placeholder="例：山田 太郎" /></Label>
        <Label text="部署"><input required autoComplete="off" className={compactField} value={employeeForm.department} onChange={(event) => updateEmployee("department", event.target.value)} placeholder="例：営業部" /></Label>
        <Label text="社員NFC UID"><input required autoComplete="off" className={compactField} value={employeeForm.nfcUid} onChange={(event) => updateEmployee("nfcUid", event.target.value)} placeholder="例：EMP-001" /></Label>
        <div className="flex gap-2 sm:col-span-2">{editingEmployee ? <Button type="button" variant="ghost" className="flex-1" onClick={() => { setEditingEmployee(null); setEmployeeForm({ code: "", name: "", department: "", nfcUid: "" }); }}>キャンセル</Button> : null}<Button type="submit" className="flex-1" disabled={submitting !== null}>{editingEmployee ? <Pencil className="size-4" /> : <Plus className="size-4" />}{submitting === "employee" ? "保存中…" : editingEmployee ? "変更を保存" : "社員を登録"}</Button></div>
      </form>
      <div className="max-h-96 overflow-y-auto p-3"><div className="divide-y divide-slate-100">{data.employees.map((person) => <div key={person.id} className={cn("flex items-center gap-3 px-2 py-3", !person.active && "opacity-55")}><span className="w-[76px] shrink-0 rounded-lg bg-slate-100 px-2 py-1 text-center text-xs font-black text-slate-600">{person.code}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{person.name}<span className={cn("ml-2 rounded-full px-2 py-0.5 text-[10px]", person.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-200 text-slate-600")}>{person.active ? "有効" : "無効"}</span></p><p className="truncate text-xs text-slate-400">{person.department} ・ {person.nfcUid}</p></div><div className="flex shrink-0 gap-1"><button type="button" aria-label={`${person.name}を編集`} onClick={() => { setEditingEmployee(person); setEmployeeForm({ code: person.code, name: person.name, department: person.department, nfcUid: person.nfcUid }); }} className="grid size-9 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><Pencil className="size-4" /></button><button type="button" aria-label={`${person.name}を${person.active ? "無効化" : "再有効化"}`} onClick={() => mutate({ action: "setEmployeeActive", id: person.id, version: person.version, active: !person.active }, person.active ? "社員を無効化しました" : "社員を再有効化しました")} className={cn("grid size-9 place-items-center rounded-lg border", person.active ? "border-rose-200 text-rose-600 hover:bg-rose-50" : "border-emerald-200 text-emerald-600 hover:bg-emerald-50")}><Power className="size-4" /></button></div></div>)}</div></div>
    </Card> : null}
    {kind === "vehicle" ? <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 p-5"><div><h2 className="font-black">{editingVehicle ? "車両情報を修正" : "車両を登録"}</h2><p className="mt-1 text-xs text-slate-500">無効化した車両は利用候補から除外されます</p></div><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">有効 {data.vehicles.filter((vehicle) => vehicle.active).length} / {data.vehicles.length}台</span></div>
      <form className="grid gap-3 border-b border-slate-100 bg-slate-50/60 p-5 sm:grid-cols-2" onSubmit={submitVehicle}>
        <Label text="車両番号"><input required disabled={!!editingVehicle} autoComplete="off" className={cn(compactField, editingVehicle && "cursor-not-allowed bg-slate-100 text-slate-500")} value={vehicleForm.code} onChange={(event) => updateVehicle("code", event.target.value)} placeholder="例：V-021" /></Label>
        <Label text="車両名"><input required autoComplete="off" className={compactField} value={vehicleForm.name} onChange={(event) => updateVehicle("name", event.target.value)} placeholder="例：営業車21" /></Label>
        <Label text="ナンバー"><input required autoComplete="off" className={compactField} value={vehicleForm.plateNumber} onChange={(event) => updateVehicle("plateNumber", event.target.value)} placeholder="例：品川 500 あ 12-34" /></Label>
        <Label text="車両NFC UID"><input required autoComplete="off" className={compactField} value={vehicleForm.nfcUid} onChange={(event) => updateVehicle("nfcUid", event.target.value)} placeholder="例：CAR-021" /></Label>
        <Label text="表示色"><span className="flex min-h-10 items-center gap-3 rounded-lg border border-slate-200 bg-white px-3"><input aria-label="車両の表示色" type="color" className="h-7 w-10 cursor-pointer border-0 bg-transparent p-0" value={vehicleForm.color} onChange={(event) => updateVehicle("color", event.target.value)} /><span className="text-xs font-bold text-slate-500">{vehicleForm.color.toUpperCase()}</span></span></Label>
        <div className="flex gap-2 self-end">{editingVehicle ? <Button type="button" variant="ghost" className="flex-1" onClick={() => { setEditingVehicle(null); setVehicleForm({ code: "", name: "", plateNumber: "", nfcUid: "", color: "#2563eb" }); }}>キャンセル</Button> : null}<Button type="submit" className="flex-1" disabled={submitting !== null}>{editingVehicle ? <Pencil className="size-4" /> : <Plus className="size-4" />}{submitting === "vehicle" ? "保存中…" : editingVehicle ? "変更を保存" : "車両を登録"}</Button></div>
      </form>
      <div className="max-h-96 overflow-y-auto p-3"><div className="divide-y divide-slate-100">{data.vehicles.map((vehicle) => <div key={vehicle.id} className={cn("flex items-center gap-3 px-2 py-3", !vehicle.active && "opacity-55")}><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-slate-100"><CarFront className="size-5" style={{ color: vehicle.color }} /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{vehicle.code} ・ {vehicle.name}</p><p className="truncate text-xs text-slate-400">{vehicle.plateNumber} ・ {vehicle.nfcUid}</p></div><span className={cn("hidden shrink-0 rounded-full px-2 py-1 text-[10px] font-bold sm:inline", !vehicle.active ? "bg-slate-200 text-slate-600" : vehicle.status === "AVAILABLE" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700")}>{!vehicle.active ? "無効" : vehicle.status === "AVAILABLE" ? "利用可能" : vehicle.status === "IN_USE" ? "利用中" : vehicle.status}</span><div className="flex shrink-0 gap-1"><button type="button" aria-label={`${vehicle.name}を編集`} onClick={() => { setEditingVehicle(vehicle); setVehicleForm({ code: vehicle.code, name: vehicle.name, plateNumber: vehicle.plateNumber, nfcUid: vehicle.nfcUid, color: vehicle.color }); }} className="grid size-9 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"><Pencil className="size-4" /></button><button type="button" aria-label={`${vehicle.name}を${vehicle.active ? "無効化" : "再有効化"}`} onClick={() => mutate({ action: "setVehicleActive", id: vehicle.id, version: vehicle.version, active: !vehicle.active }, vehicle.active ? "車両を無効化しました" : "車両を再有効化しました")} className={cn("grid size-9 place-items-center rounded-lg border", vehicle.active ? "border-rose-200 text-rose-600 hover:bg-rose-50" : "border-emerald-200 text-emerald-600 hover:bg-emerald-50")}><Power className="size-4" /></button></div></div>)}</div></div>
    </Card> : null}
  </section>;
}

function Timeline({ data, mutate, openStart, openEdit, actorName, highlightTripId, timelineDate, timelineDays, setTimelineDate, setTimelineDays }: { data: DashboardData; mutate: (body: object, success: string) => Promise<boolean>; openStart: (v?: Vehicle) => void; openEdit: (t: Trip) => void; actorName: string; highlightTripId?: string; timelineDate: Date; timelineDays: 1 | 3; setTimelineDate: React.Dispatch<React.SetStateAction<Date>>; setTimelineDays: React.Dispatch<React.SetStateAction<1 | 3>> }) {
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => new Date());
  const drag = useRef<{ trip: Trip; x: number } | null>(null);
  const moved = useRef(false);
  const highlightedTrip = useRef<HTMLButtonElement | null>(null);
  const highlightedRow = useRef<HTMLDivElement | null>(null);
  const scrollArea = useRef<HTMLDivElement | null>(null);
  const timelineStart = new Date(timelineDate.getTime() + (timelineDays === 1 ? DAY_VIEW_START_MINUTE : 0) * 60_000);
  const timelineEnd = new Date(timelineDate.getTime() + (timelineDays === 1 ? DAY_VIEW_END_MINUTE : timelineDays * MINUTES_PER_DAY) * 60_000);
  const timelineMinutes = timelineDays === 1 ? DAY_VIEW_END_MINUTE - DAY_VIEW_START_MINUTE : timelineDays * MINUTES_PER_DAY;
  const pxPerMinute = timelineDays === 1 ? 1.08 : 0.24;
  const timelineWidth = timelineMinutes * pxPerMinute;
  const days = Array.from({ length: timelineDays }, (_, index) => new Date(timelineDate.getTime() + index * 24 * 60 * 60_000));
  const timeTicks = timelineDays === 1
    ? Array.from({ length: timelineMinutes / 30 + 1 }, (_, index) => index * 30)
    : Array.from({ length: timelineDays * 4 + 1 }, (_, index) => index * 6 * 60);
  const rowGridStyle = timelineDays === 1
    ? {
        backgroundImage: "linear-gradient(to right, #cbd5e1 1px, transparent 1px), linear-gradient(to right, #e2e8f0 1px, transparent 1px)",
        backgroundSize: `${60 * pxPerMinute}px 100%, ${30 * pxPerMinute}px 100%`,
      }
    : {
        backgroundImage: "linear-gradient(to right, #e2e8f0 1px, transparent 1px)",
        backgroundSize: `${6 * 60 * pxPerMinute}px 100%`,
      };
  const getMinute = (iso: string) => (new Date(iso).getTime() - timelineStart.getTime()) / 60_000;
  const todayStart = tokyoDayStart(now);
  const includesNow = now >= timelineStart && now < timelineEnd;
  const nowMinute = (now.getTime() - timelineStart.getTime()) / 60_000;
  const moveDay = (amount: number) => setTimelineDate((current) => new Date(current.getTime() + amount * 24 * 60 * 60_000));
  const scrollToNow = (smooth = true) => {
    const area = scrollArea.current;
    if (!area || !includesNow) return;
    area.scrollTo({ left: Math.max(0, nowMinute * pxPerMinute - area.clientWidth / 2 + 64), behavior: smooth ? "smooth" : "auto" });
  };
  const beginDrag = (event: React.PointerEvent, trip: Trip) => {
    if (trip.status === "COMPLETED") return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = { trip, x: event.clientX };
    moved.current = false;
  };
  const onMove = (event: React.PointerEvent, trip: Trip) => {
    if (drag.current?.trip.id !== trip.id) return;
    const delta = Math.round((event.clientX - drag.current.x) / pxPerMinute / 15) * 15;
    if (delta !== 0) moved.current = true;
    setDraft((current) => ({ ...current, [trip.id]: delta }));
  };
  const endDrag = async (trip: Trip) => {
    if (drag.current?.trip.id !== trip.id) return;
    const delta = draft[trip.id] ?? 0;
    drag.current = null;
    if (delta) {
      await mutate({ action: "moveTrip", tripId: trip.id, version: trip.version, plannedStart: new Date(new Date(trip.plannedStart).getTime() + delta * 60_000).toISOString(), plannedEnd: new Date(new Date(trip.plannedEnd).getTime() + delta * 60_000).toISOString(), actorName }, "利用時間を変更しました");
    }
    setDraft((current) => { const next = { ...current }; delete next[trip.id]; return next; });
  };

  useEffect(() => {
    if (!highlightTripId) return;
    highlightedRow.current?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    highlightedTrip.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [highlightTripId]);

  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 60_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { if (includesNow) scrollToNow(false); }, [timelineDate, timelineDays]);

  return <><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 p-3">
    <div className="flex items-center gap-1"><button aria-label="前日" onClick={() => moveDay(-1)} className="grid size-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"><ChevronLeft className="size-4" /></button><button onClick={() => setTimelineDate(tokyoDayStart())} className="min-h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50">今日</button><button aria-label="翌日" onClick={() => moveDay(1)} className="grid size-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"><ChevronRight className="size-4" /></button><span className="ml-2 text-sm font-black">{jpShortDate.format(timelineStart)}{timelineDays === 3 ? `〜${jpShortDate.format(new Date(timelineEnd.getTime() - 1))}` : ""}</span></div>
    <div className="flex items-center gap-2">{includesNow ? <button onClick={() => scrollToNow()} className="min-h-9 rounded-lg px-3 text-xs font-bold text-blue-700 hover:bg-blue-50">現在時刻へ</button> : null}<div className="flex rounded-xl bg-slate-200 p-1"><button onClick={() => setTimelineDays(1)} className={cn("min-h-8 rounded-lg px-3 text-xs font-bold", timelineDays === 1 ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>1日</button><button onClick={() => setTimelineDays(3)} className={cn("min-h-8 rounded-lg px-3 text-xs font-bold", timelineDays === 3 ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>3日</button></div></div>
  </div><div ref={scrollArea} className="overflow-x-auto">
    <div className="min-w-max">
      <div className="sticky top-0 z-10 ml-32 bg-white" style={{ width: timelineWidth }}><div className="flex h-7 border-b border-slate-200">{days.map((day) => { const isToday = day.getTime() === todayStart.getTime(); return <div key={day.toISOString()} className={cn("border-l px-2 py-1 text-xs font-black", isToday ? "border-blue-400 bg-blue-50 text-blue-700" : "border-slate-300 bg-slate-50 text-slate-600")} style={{ width: (timelineDays === 1 ? timelineMinutes : MINUTES_PER_DAY) * pxPerMinute }}>{isToday ? "今日 " : ""}{jpShortDate.format(day)}</div>; })}</div><div className="relative h-7 border-b border-slate-100">{timeTicks.map((minute) => { const isHour = minute % 60 === 0; const isEnd = minute === timelineMinutes; const displayMinute = minute + (timelineDays === 1 ? DAY_VIEW_START_MINUTE : 0); return <span key={minute} className={cn("absolute inset-y-0 border-l", isHour ? "border-slate-300" : "border-slate-200")} style={{ left: minute * pxPerMinute }}>{isHour && !isEnd ? <span className="absolute left-1 top-1 whitespace-nowrap text-[9px] font-bold text-slate-500">{Math.floor(displayMinute / 60) % 24}:00</span> : null}</span>; })}{includesNow ? <span className="absolute inset-y-0 z-20 w-0.5 bg-rose-500" style={{ left: nowMinute * pxPerMinute }}><i className="absolute -left-1 top-0 size-2.5 rounded-full bg-rose-500" /></span> : null}</div></div>
      {data.vehicles.map((vehicle) => {
        const trips = data.trips.filter((trip) => trip.vehicleId === vehicle.id && new Date(trip.plannedEnd) > timelineStart && new Date(trip.plannedStart) < timelineEnd);
        const isHighlightedVehicle = trips.some((trip) => trip.id === highlightTripId);
        const parkingSpot = data.spots.find((spot) => spot.vehicle?.id === vehicle.id);
        const locationLabel = vehicle.status === "IN_USE" ? "外出中" : vehicle.status === "MAINTENANCE" ? "整備中" : parkingSpot ? `区画 ${parkingSpot.code}` : "位置未設定";
        return <div ref={isHighlightedVehicle ? highlightedRow : undefined} key={vehicle.id} className={cn("flex h-[62px] border-b border-slate-100 last:border-0", isHighlightedVehicle && "bg-amber-50 ring-2 ring-inset ring-amber-300")}>
          <button onClick={() => vehicle.active && vehicle.status === "AVAILABLE" && openStart(vehicle)} className={cn("sticky left-0 z-20 flex w-32 shrink-0 items-center gap-2 border-r border-slate-200 bg-white px-3 text-left hover:bg-slate-50", isHighlightedVehicle && "bg-amber-100", !vehicle.active && "opacity-50")}>
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: vehicle.color }} /><span className="min-w-0 flex-1"><span className="flex min-w-0 items-center gap-1"><b className="min-w-0 flex-1 truncate text-xs">{vehicle.name}</b>{isHighlightedVehicle ? <small className="shrink-0 rounded bg-amber-500 px-1 py-0.5 text-[8px] font-black text-white">登録</small> : null}</span><small title={`${formatPlateShort(vehicle.plateNumber)} ・ ${locationLabel}`} className={cn("block truncate text-[9px] font-bold", vehicle.status === "IN_USE" ? "text-blue-600" : parkingSpot ? "text-emerald-600" : "text-slate-500")}>{formatPlateShort(vehicle.plateNumber)} ・ {locationLabel}</small></span>
          </button>
          <div className="relative" style={{ width: timelineWidth, ...rowGridStyle }}>
            {includesNow ? <span className="pointer-events-none absolute inset-y-0 z-[1] w-0.5 bg-rose-400/70" style={{ left: nowMinute * pxPerMinute }} /> : null}
            {trips.map((trip) => {
              const delta = draft[trip.id] ?? 0;
              const start = getMinute(trip.plannedStart) + delta;
              const duration = Math.max(45, (new Date(trip.plannedEnd).getTime() - new Date(trip.plannedStart).getTime()) / 60_000);
              const visibleStart = Math.max(0, start);
              const visibleEnd = Math.min(timelineMinutes, start + duration);
              const visibleDuration = Math.max(0, visibleEnd - visibleStart);
              const continuesBefore = start < 0;
              const continuesAfter = start + duration > timelineMinutes;
              const color = trip.status === "IN_USE" ? "bg-blue-500" : trip.status === "COMPLETED" ? "bg-slate-400" : "bg-violet-500";
              const isHighlighted = trip.id === highlightTripId;
              if (visibleDuration <= 0) return null;
              return <button ref={isHighlighted ? highlightedTrip : undefined} key={trip.id} title={`${trip.employee.name} ${formatDateTime(trip.plannedStart)}–${formatDateTime(trip.plannedEnd)}`} onClick={() => { if (moved.current) { moved.current = false; return; } if (trip.status !== "COMPLETED") openEdit(trip); }} onPointerDown={(e) => beginDrag(e, trip)} onPointerMove={(e) => onMove(e, trip)} onPointerUp={() => endDrag(trip)} className={cn("absolute top-2 z-[2] h-11 touch-none select-none overflow-hidden rounded-xl px-3 text-left text-white shadow-sm", color, trip.status !== "COMPLETED" && "cursor-grab active:cursor-grabbing", isHighlighted && "z-10 ring-4 ring-amber-300 shadow-xl animate-pulse")} style={{ left: visibleStart * pxPerMinute, width: visibleDuration * pxPerMinute }}>
                <span className="block truncate text-xs font-black">{continuesBefore ? "◀ 継続 ・ " : ""}{isHighlighted ? "登録済 ・ " : ""}{trip.employee.name}{continuesAfter ? " ・ 翌日へ ▶" : ""}</span><span className="block truncate text-[10px] opacity-80">{formatTime(trip.plannedStart)}～{formatTime(trip.plannedEnd)}</span>
              </button>;
            })}
          </div>
        </div>;
      })}
    </div>
  </div></>;
}

function ParkingMap({ data, changedVehicleIds, mutate, openStart, openReturn, openMove, actorName }: { data: DashboardData; changedVehicleIds: string[]; mutate: (body: object, success: string) => Promise<boolean>; openStart: (vehicle?: Vehicle) => void; openReturn: (spot: ParkingSpot) => void; openMove: (vehicle: Vehicle) => void; actorName: string }) {
  const [dragVehicle, setDragVehicle] = useState<Vehicle | null>(null);
  return <Card className="overflow-hidden">
    <div className="p-4 md:p-5">
      <div className="relative mx-auto aspect-[950/525] w-full max-w-[1180px] overflow-hidden rounded-xl border border-slate-200 bg-white">
        <img src="/parking-layout.svg" alt="" className="pointer-events-none absolute inset-0 size-full select-none" draggable={false} />
        {data.spots.map((spot) => <div key={spot.id} onDragOver={(e) => { if (!spot.vehicle) e.preventDefault(); }} onDrop={() => { if (dragVehicle && !spot.vehicle) mutate({ action: "moveVehicle", vehicleId: dragVehicle.id, version: dragVehicle.version, spotId: spot.id, actorName }, `区画${spot.code}へ移動しました`); setDragVehicle(null); }} className={cn("absolute grid place-items-center rounded-[4px] border-2 transition", spot.vehicle ? "border-rose-500 bg-rose-50" : TEMPORARY_SPOT_CODES.has(spot.code) ? "border-amber-500 bg-amber-50" : "border-emerald-500 bg-emerald-50", TEMPORARY_SPOT_CODES.has(spot.code) && "border-dashed", dragVehicle && !spot.vehicle && "border-dashed bg-emerald-100", spot.vehicle && changedVehicleIds.includes(spot.vehicle.id) && "z-10 ring-4 ring-amber-300 animate-pulse")} style={{ left: `${spot.x}%`, top: `${spot.y}%`, width: `${spot.width}%`, height: `${spot.height}%` }}>
          <span className="absolute left-1 top-0.5 z-[1] text-[9px] font-black text-slate-500">{spot.code}{CUSTOMER_SPOT_CODES.has(spot.code) ? <small className="ml-0.5 hidden text-[7px] text-blue-700 sm:inline">お客様用</small> : TEMPORARY_SPOT_CODES.has(spot.code) ? <small className="ml-0.5 hidden text-[7px] text-amber-800 sm:inline">臨時</small> : null}</span>
          {spot.vehicle ? <div className="relative size-full"><button type="button" title={`${spot.vehicle.name}（${spot.vehicle.plateNumber}・${spot.vehicle.code}）を利用開始`} onClick={() => { if (spot.vehicle?.status === "AVAILABLE") openStart(spot.vehicle); }} className={cn("grid size-full place-content-center overflow-hidden text-center", spot.vehicle.status !== "AVAILABLE" && "cursor-not-allowed opacity-60")}><CarFront className="mx-auto size-4 sm:size-5" style={{ color: spot.vehicle.color }} /><b className="mt-0.5 block max-w-full truncate px-1 text-[8px] leading-tight sm:text-[10px]">{spot.vehicle.name}</b><small className="mt-0.5 block whitespace-nowrap text-[7px] font-bold leading-none text-slate-500 sm:text-[8px]">{formatPlateShort(spot.vehicle.plateNumber)} ・ {spot.vehicle.code}</small></button><button type="button" title="駐車位置を移動" aria-label={`${spot.vehicle.name}の駐車位置を移動`} onClick={() => openMove(spot.vehicle!)} draggable onDragStart={() => setDragVehicle(spot.vehicle)} onDragEnd={() => setDragVehicle(null)} className="absolute right-1 top-1 grid size-8 cursor-grab place-items-center rounded-lg border border-slate-200 bg-white/95 text-slate-600 shadow-md transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 active:cursor-grabbing"><GripVertical className="size-4" /></button></div> : <button type="button" title={`${formatSpotLabel(spot.code)}へ返却`} onClick={() => { if (!dragVehicle) openReturn(spot); }} className={cn("grid size-full place-content-center text-center text-[9px] font-bold transition sm:text-[10px]", TEMPORARY_SPOT_CODES.has(spot.code) ? "text-amber-800 hover:bg-amber-100" : "text-emerald-700 hover:bg-emerald-100")}><MapPin className="mx-auto mb-0.5 size-3" />{TEMPORARY_SPOT_CODES.has(spot.code) ? "臨時" : "空き"}<span className="hidden sm:block">{TEMPORARY_SPOT_CODES.has(spot.code) ? "駐車可" : "返却"}</span></button>}
        </div>)}
      </div>
    </div>
  </Card>;
}

function DialogShell({ title, subtitle, onClose, children, wide = false }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = dialog?.querySelector<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])");
    focusable?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !dialog) return;
      const items = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])")];
      if (items.length === 0) return;
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); returnFocus.current?.focus(); };
  }, [onClose]);
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-3 backdrop-blur-sm sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className={cn("max-h-[94vh] w-full overflow-y-auto rounded-2xl bg-white shadow-2xl sm:rounded-3xl", wide ? "max-w-3xl" : "max-w-lg")}><div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-100 bg-white p-4 sm:p-5"><div><h2 id={titleId} className="text-lg font-black">{title}</h2><p className="mt-1 text-xs text-slate-500">{subtitle}</p></div><button aria-label="閉じる" onClick={onClose} className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100"><X className="size-4" /></button></div><div className="p-4 sm:p-5">{children}</div></div></div>;
}
const field = "min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50";
const compactField = "min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50";
function StartDialog({ employees, vehicles, initialEmployee, initialVehicleId, submitting, onClose, onSubmit }: { employees: Employee[]; vehicles: Vehicle[]; initialEmployee: Employee | null; initialVehicleId: string; submitting: boolean; onClose: () => void; onSubmit: (v: { employeeId: string; employeeName: string; vehicleId: string; minutes: number }) => void }) {
  const [employeeId, setEmployeeId] = useState(initialEmployee?.id ?? "");
  const [nfcUid, setNfcUid] = useState(initialEmployee?.nfcUid ?? "");
  const [nfcError, setNfcError] = useState("");
  const vehicleId = initialVehicleId;
  const [hours, setHours] = useState(1);
  const [minutes, setMinutes] = useState(0);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 30_000); return () => window.clearInterval(timer); }, []);
  const orderedEmployees = [...employees].sort((left, right) => left.code.localeCompare(right.code, "ja", { numeric: true }));
  const selectedEmployee = employees.find((person) => person.id === employeeId);
  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === vehicleId);
  const totalMinutes = hours * 60 + minutes;
  const plannedEnd = new Date(now.getTime() + totalMinutes * 60_000);
  const identifyEmployee = (uid: string) => {
    const person = employees.find((item) => item.nfcUid.toLowerCase() === uid.trim().toLowerCase());
    if (!person) { setEmployeeId(""); setNfcError("登録されていない社員タグです"); return; }
    setEmployeeId(person.id); setNfcUid(person.nfcUid); setNfcError("");
  };
  return <DialogShell wide title="利用開始を登録" subtitle="社員NFC・車両・返却予定を確認してください" onClose={onClose}><form className="grid gap-5 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (selectedEmployee) onSubmit({ employeeId, employeeName: selectedEmployee.name, vehicleId, minutes: totalMinutes }); }}>
    <div className="flex h-full flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 md:min-h-[330px]"><div><p className="mb-1.5 text-xs font-bold text-slate-600">利用者（社員NFC）</p>{selectedEmployee ? <div className="flex min-h-24 items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3"><span className="grid size-10 place-items-center rounded-full bg-emerald-600 text-white"><UserRound className="size-5" /></span><div className="min-w-0 flex-1"><p className="font-black">{selectedEmployee.name}</p><p className="text-xs text-emerald-700">社員番号 {selectedEmployee.code} ・ {selectedEmployee.department}</p></div><button type="button" onClick={() => { setEmployeeId(""); setNfcUid(""); }} className="shrink-0 whitespace-nowrap text-xs font-bold text-emerald-700">選び直す</button></div> : <div className="rounded-xl border border-blue-200 bg-blue-50 p-3"><div className="mb-2 flex items-center gap-2 text-blue-700"><Nfc className="size-7 animate-pulse" /><div><p className="text-sm font-black">社員証をかざしてください</p><p className="text-[10px] text-blue-500">UIDを読み取り、Enterで認識します</p></div></div><div className="flex gap-2"><input autoFocus className={compactField} value={nfcUid} onChange={(event) => setNfcUid(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); identifyEmployee(nfcUid); } }} placeholder="NFC UID" /><Button type="button" className="min-h-10 shrink-0 whitespace-nowrap px-3" onClick={() => identifyEmployee(nfcUid)}>認識</Button></div>{nfcError ? <p className="mt-1.5 text-xs font-bold text-rose-600">{nfcError}</p> : null}<div className="my-2 flex items-center gap-2 text-[10px] font-bold text-slate-400"><span className="h-px flex-1 bg-blue-200" />NFCを忘れた場合<span className="h-px flex-1 bg-blue-200" /></div><select aria-label="社員を選択" className={compactField} value="" onChange={(event) => { const person = employees.find((item) => item.id === event.target.value); if (person) { setEmployeeId(person.id); setNfcUid(person.nfcUid); setNfcError(""); } }}><option value="">社員番号から選択してください</option>{orderedEmployees.map((person) => <option key={person.id} value={person.id}>{person.code}　{person.name}（{person.department}）</option>)}</select></div>}</div><div className="mt-auto"><p className="mb-1.5 text-xs font-bold text-slate-600">車両（変更不可）</p>{selectedVehicle ? <div className="flex min-h-16 items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white"><CarFront className="size-5" style={{ color: selectedVehicle.color }} /></span><div className="min-w-0"><p className="truncate text-sm font-black text-slate-900">{selectedVehicle.name}</p><p className="truncate text-xs text-blue-700">{selectedVehicle.plateNumber}</p></div></div> : <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-700">車両を確認できません。画面を閉じて選び直してください。</p>}<p className="mt-1.5 text-[10px] text-slate-400">変更する場合はこの画面を閉じ、利用する車両を選び直してください。</p></div></div>
    <div className="flex h-full flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 md:min-h-[330px]"><div><p className="mb-1.5 text-xs font-bold text-slate-600">利用予定時間</p><div className="grid grid-cols-2 gap-3"><Label text="時間"><div className="relative"><input type="number" inputMode="numeric" min={0} max={168} className={cn(compactField, "pr-12")} value={hours} onChange={(event) => setHours(Math.max(0, Math.min(168, Number(event.target.value))))} /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">時間</span></div></Label><Label text="分"><select className={compactField} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}>{[0, 15, 30, 45].map((value) => <option key={value} value={value}>{value}分</option>)}</select></Label></div><p className="mt-1.5 text-[10px] text-slate-400">15分から最長7日間まで指定できます。</p></div>
      <div><p className="mb-1.5 text-xs font-bold text-slate-600">利用時刻</p><div className="grid grid-cols-2 gap-3"><div className="min-h-16 rounded-xl border border-slate-200 bg-white p-3"><p className="text-[10px] font-bold text-slate-500">利用開始</p><p className="mt-1.5 whitespace-nowrap text-sm font-black text-slate-900">{formatDateTime(now)}</p></div><div className="min-h-16 rounded-xl border border-emerald-200 bg-emerald-50 p-3"><p className="text-[10px] font-bold text-emerald-700">返却予定</p><p className="mt-1.5 whitespace-nowrap text-sm font-black text-emerald-800">{formatDateTime(plannedEnd)}</p></div></div></div>
      <Button type="submit" className="mt-auto min-h-10 w-full" disabled={submitting || !selectedEmployee || !selectedVehicle || totalMinutes < 15 || totalMinutes > 10_080}>{submitting ? <LoaderCircle className="size-4 animate-spin" /> : <CarFront className="size-4" />}{submitting ? "登録中…" : "この内容で利用開始"}</Button></div>
  </form></DialogShell>;
}
function EditTripDialog({ trip, submitting, onClose, onAdjust, onCancel }: { trip: Trip; submitting: boolean; onClose: () => void; onAdjust: (minutes: -60 | -30 | -15 | 15 | 30 | 60) => void; onCancel: () => void }) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const durationMinutes = (new Date(trip.plannedEnd).getTime() - new Date(trip.plannedStart).getTime()) / 60_000;
  return <DialogShell title="登録情報を修正" subtitle={`${trip.vehicle.name} ・ ${trip.employee.name}`} onClose={onClose}><div className="space-y-5">
    <div className="rounded-2xl bg-slate-50 p-4"><div className="flex items-center justify-between gap-3"><span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-bold", trip.status === "IN_USE" ? "bg-blue-100 text-blue-700" : "bg-violet-100 text-violet-700")}>{trip.status === "IN_USE" ? "利用中" : "予約"}</span><span className="text-right text-sm font-black">{formatDateTime(trip.plannedStart)}–{formatDateTime(trip.plannedEnd)}</span></div></div>
    <div><p className="mb-2 text-xs font-bold text-slate-600">終了時間を変更</p><div className="grid grid-cols-3 gap-2">{([-15, -30, -60] as const).map((minutes) => <button key={minutes} disabled={submitting || durationMinutes + minutes < 15} onClick={() => onAdjust(minutes)} className="min-h-12 rounded-xl border border-amber-200 bg-amber-50 text-sm font-black text-amber-700 transition hover:border-amber-500 disabled:cursor-not-allowed disabled:opacity-35">{minutes}分</button>)}</div><div className="mt-2 grid grid-cols-3 gap-2">{([15, 30, 60] as const).map((minutes) => <button key={minutes} disabled={submitting} onClick={() => onAdjust(minutes)} className="min-h-12 rounded-xl border border-blue-200 bg-blue-50 text-sm font-black text-blue-700 transition hover:border-blue-500 disabled:opacity-40">+{minutes}分</button>)}</div><p className="mt-2 text-[11px] text-slate-400">15分未満への短縮、現在時刻以前への短縮、次の予約と重なる延長はできません。</p></div>
    {trip.status === "RESERVED" ? <div className="border-t border-slate-100 pt-4">{confirmCancel ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4"><p className="text-sm font-bold text-rose-800">この予約を取り消しますか？</p><div className="mt-3 grid grid-cols-2 gap-2"><Button variant="ghost" onClick={() => setConfirmCancel(false)}>戻る</Button><Button variant="danger" onClick={onCancel}>予約を取り消す</Button></div></div> : <Button variant="ghost" className="w-full border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => setConfirmCancel(true)}>予約の取り消し</Button>}</div> : null}
  </div></DialogShell>;
}
function ParkingReturnDialog({ spot, trips, submitting, onClose, onSubmit }: { spot: ParkingSpot; trips: Trip[]; submitting: boolean; onClose: () => void; onSubmit: (trip: Trip) => void }) {
  const [method, setMethod] = useState<"manual" | "nfc">("manual");
  const [tripId, setTripId] = useState("");
  const selected = trips.find((trip) => trip.id === tripId);
  return <DialogShell title={`${formatSpotLabel(spot.code)} へ返却`} subtitle={CUSTOMER_SPOT_CODES.has(spot.code) ? "お客様用区画ですが、社用車も返却できます" : TEMPORARY_SPOT_CODES.has(spot.code) ? "通常区画ではありませんが、臨時の返却先として利用できます" : "返却する車両を手動選択、またはNFCタグで認識してください"} onClose={onClose}><div className="space-y-4">
    <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1"><button type="button" onClick={() => setMethod("manual")} className={cn("min-h-11 rounded-lg text-sm font-bold transition", method === "manual" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>手動で選択</button><button type="button" onClick={() => setMethod("nfc")} className={cn("flex min-h-11 items-center justify-center gap-2 rounded-lg text-sm font-bold transition", method === "nfc" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500")}><Nfc className="size-4" />NFCで認識</button></div>
    {trips.length === 0 ? <Empty label="現在利用中の車両はありません" /> : method === "manual" ? <Label text="返却する車両"><select className={field} value={tripId} onChange={(event) => setTripId(event.target.value)}><option value="">車両を選択してください</option>{trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.vehicle.name}　{trip.vehicle.plateNumber}（{trip.employee.name}）</option>)}</select></Label> : <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4"><div className="mb-4 text-center text-blue-700"><Nfc className="mx-auto size-10 animate-pulse" /><p className="mt-2 text-sm font-bold">車両のNFCタグをかざしてください</p><p className="text-[11px] text-blue-500">開発環境では下のタグで読取を再現できます</p></div>{process.env.NODE_ENV === "development" ? <div className="grid gap-2 sm:grid-cols-2">{trips.map((trip) => <button type="button" key={trip.id} onClick={() => setTripId(trip.id)} className={cn("rounded-xl border bg-white p-3 text-left text-xs transition", tripId === trip.id ? "border-blue-500 ring-2 ring-blue-200" : "border-blue-100 hover:border-blue-300")}><b className="block">{trip.vehicle.nfcUid}</b><span className="text-slate-500">{trip.vehicle.name} ・ {trip.employee.name}</span></button>)}</div> : null}</div>}
    {selected ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-xs font-bold text-emerald-700">返却内容</p><div className="mt-2 flex items-center gap-3"><CarFront className="size-6 text-emerald-700" /><div><p className="font-black">{selected.vehicle.name} → {formatSpotLabel(spot.code)}</p><p className="text-xs text-emerald-700">利用者：{selected.employee.name} ・ 利用開始 {formatTime(selected.plannedStart)}</p></div></div></div> : null}
    <Button className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={!selected || submitting} onClick={() => selected && onSubmit(selected)}>{submitting ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}{submitting ? "返却登録中…" : "返却を完了して利用可能にする"}</Button>
    <p className="text-center text-[11px] text-slate-400">完了するとタイムラインが返却済みになり、この車両をすぐ利用できます。</p>
  </div></DialogShell>;
}
function EndDialog({ trip, spots, submitting, onClose, onSubmit }: { trip: Trip; spots: ParkingSpot[]; submitting: boolean; onClose: () => void; onSubmit: (spotId: string) => void }) {
  const free = spots.filter((spot) => !spot.vehicle); const [spotId, setSpotId] = useState("");
  const selected = free.find((spot) => spot.id === spotId);
  return <DialogShell title="返却・駐車位置を登録" subtitle={`${trip.vehicle.name} の返却先を選択してください（お客様用・臨時にも駐車可）`} onClose={onClose}><div className="space-y-4"><div className="grid grid-cols-3 gap-2">{free.map((spot) => <button key={spot.id} onClick={() => setSpotId(spot.id)} className={cn("min-h-14 rounded-xl border text-sm font-black", spotId === spot.id ? "border-emerald-500 bg-emerald-50 text-emerald-700 ring-2 ring-emerald-200" : "border-slate-200")}>{formatSpotLabel(spot.code)}</button>)}</div>{selected ? <div className="rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{trip.vehicle.name}を{formatSpotLabel(selected.code)}へ返却します</div> : <p className="text-center text-xs font-bold text-amber-700">返却した区画を選択してください</p>}<Button className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={!spotId || submitting} onClick={() => onSubmit(spotId)}>{submitting ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}{submitting ? "返却登録中…" : "返却を完了"}</Button></div></DialogShell>;
}

function MoveVehicleDialog({ vehicle, spots, submitting, onClose, onSubmit }: { vehicle: Vehicle; spots: ParkingSpot[]; submitting: boolean; onClose: () => void; onSubmit: (spotId: string) => void }) {
  const [spotId, setSpotId] = useState("");
  const free = spots.filter((spot) => !spot.vehicle);
  return <DialogShell title="駐車位置を変更" subtitle={`${vehicle.name} の移動先を選択してください（お客様用・臨時にも駐車可）`} onClose={onClose}><div className="space-y-4"><div className="grid grid-cols-3 gap-2">{free.map((spot) => <button type="button" key={spot.id} onClick={() => setSpotId(spot.id)} className={cn("min-h-14 rounded-xl border text-sm font-black", spotId === spot.id ? "border-blue-500 bg-blue-50 text-blue-700 ring-2 ring-blue-200" : "border-slate-200")}>{formatSpotLabel(spot.code)}</button>)}</div><Button className="w-full" disabled={!spotId || submitting} onClick={() => onSubmit(spotId)}>{submitting ? <LoaderCircle className="size-4 animate-spin" /> : <MapPin className="size-4" />}{submitting ? "移動中…" : "この区画へ移動"}</Button></div></DialogShell>;
}
function NfcDialog({ employees, vehicles, onEmployee, onVehicle, onClose }: { employees: Employee[]; vehicles: Vehicle[]; onEmployee: (e: Employee) => void; onVehicle: (v: Vehicle) => void; onClose: () => void }) {
  const development = process.env.NODE_ENV === "development";
  return <DialogShell title="NFCタグを読み取る" subtitle={development ? "リーダー入力を待機しています。開発用タグでも動作を確認できます。" : "リーダー入力を待機しています。"} onClose={onClose}><div className="text-center"><div className="mx-auto mb-5 grid size-24 place-items-center rounded-full bg-blue-50 text-blue-600"><Nfc className="size-12 animate-pulse" /></div><p className="mb-4 text-sm font-bold">タグをリーダーにかざしてください</p>{development ? <div className="grid grid-cols-2 gap-3 text-left"><div><p className="mb-2 text-xs font-bold text-slate-400">社員タグ（開発用）</p>{employees.slice(0, 3).map((p) => <button key={p.id} onClick={() => onEmployee(p)} className="mb-2 w-full rounded-xl border border-slate-200 p-3 text-xs font-bold hover:bg-slate-50">{p.nfcUid}<small className="block font-normal text-slate-400">{p.name}</small></button>)}</div><div><p className="mb-2 text-xs font-bold text-slate-400">車両タグ（開発用）</p>{vehicles.slice(0, 3).map((v) => <button key={v.id} onClick={() => onVehicle(v)} className="mb-2 w-full rounded-xl border border-slate-200 p-3 text-xs font-bold hover:bg-slate-50">{v.nfcUid}<small className="block font-normal text-slate-400">{v.name}</small></button>)}</div></div> : <p className="rounded-xl bg-slate-50 p-4 text-xs text-slate-500">読み取り完了までこの画面を開いたままにしてください。</p>}</div></DialogShell>;
}
function Label({ text, children }: { text: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-600">{text}</span>{children}</label>; }
