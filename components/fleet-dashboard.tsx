"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Archive, CarFront, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock3, GripVertical, LayoutGrid, List, LoaderCircle, LogOut, Map as MapIcon, MapPin, Nfc, Pencil, Plus, Power, Printer, RefreshCw, Settings, UserRound, X } from "lucide-react";
import type { DashboardData, Employee, ParkingSpot, Trip, Vehicle } from "@/lib/types";
import { normalizeNfcUid, sameNfcUid } from "@/lib/nfc";
import { CUSTOMER_SPOT_CODES, formatSpotLabel, HOLDING_SPOT_CODES, SAKURA_SPOT_CODE, TEMPORARY_SPOT_CODES } from "@/lib/parking-spots";
import { RESERVATION_GRACE_MINUTES } from "@/lib/reservations";
import { nfcBridgeStatusText, useNfcBridge, useNfcBridgeHealth, type NfcBridgeStatus } from "@/lib/use-nfc-bridge";
import { SettingsPanelV2 } from "./settings-panel-v2";
import { AdminGate } from "./admin-gate";
import { Button, Card, cn } from "./ui";

const MINUTES_PER_DAY = 24 * 60;
const DAY_VIEW_START_MINUTE = 6 * 60;
const DAY_VIEW_END_MINUTE = 22 * 60;
const SAKURA_VEHICLE_CODE = "C07";
type Dialog = "start" | "end" | "parkingReturn" | "moveVehicle" | "edit" | "nfc" | null;
type DashboardView = "parking" | "timeline" | "settingsEmployees" | "settingsVehicles";
type SyncState = "loading" | "healthy" | "stale";
type StartContext = { vehicleId: string; employeeId: string };
type UndoReturn = { tripId: string; vehicleId: string; vehicleName: string; expiresAt: number };
const jpTime = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false });
const jpTimeSeconds = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const jpDate = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "long", day: "numeric", weekday: "long" });
const jpShortDate = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", weekday: "short" });
const jpDateTime = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const formatTime = (value: string | Date) => jpTime.format(new Date(value));
const formatDateTime = (value: string | Date) => jpDateTime.format(new Date(value));
const nextQuarterHour = (value = Date.now()) => new Date(Math.ceil((value + 1) / (15 * 60_000)) * 15 * 60_000);
const toLocalDateTimeInput = (value: Date) => new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const nextAllDayStart = () => {
  const start = new Date();
  start.setHours(6, 0, 0, 0);
  if (start <= new Date()) start.setDate(start.getDate() + 1);
  return start;
};
const timelineStartOf = (trip: Trip) => trip.status !== "RESERVED" && trip.actualStart ? trip.actualStart : trip.plannedStart;
const timelineEndOf = (trip: Trip, now = Date.now()) => {
  if (trip.status === "COMPLETED" && trip.actualEnd) return trip.actualEnd;
  if (trip.status === "IN_USE" && new Date(trip.plannedEnd).getTime() < now) return new Date(now).toISOString();
  return trip.plannedEnd;
};
const formatPlateShort = (value: string) => {
  const parts = value.trim().split(/\s+/);
  return parts[parts.length - 1] || value;
};
const isSakuraSpot = (spot: ParkingSpot) => spot.code === SAKURA_SPOT_CODE;
const canUseSpot = (vehicle: Vehicle, spot: ParkingSpot) => !isSakuraSpot(spot) || vehicle.code === SAKURA_VEHICLE_CODE;
const parkingSpotClass = (spot: ParkingSpot) => {
  const auxiliary = HOLDING_SPOT_CODES.has(spot.code) || TEMPORARY_SPOT_CODES.has(spot.code);
  if (spot.vehicle) return cn("border-rose-500 bg-rose-50", auxiliary && "border-[3px] border-dashed");
  return auxiliary ? "border-[3px] border-dashed border-slate-300/70 bg-slate-50/70" : "border-slate-300 bg-white/90";
};
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
  const [undoReturn, setUndoReturn] = useState<UndoReturn | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>("loading");
  const [isOnline, setIsOnline] = useState(true);
  const [lastSuccessfulSync, setLastSuccessfulSync] = useState<Date | null>(null);
  const loadInFlight = useRef(false);
  const dataRef = useRef<DashboardData | null>(null);
  const [pendingAction, setPendingAction] = useState(false);
  const pendingRef = useRef(false);
  const [parkingMode, setParkingMode] = useState<"map" | "active">("map");
  const [timelineMode, setTimelineMode] = useState<"chart" | "list">("chart");
  const [changedVehicleIds, setChangedVehicleIds] = useState<string[]>([]);
  const vehicleVersions = useRef(new Map<string, number>());
  const [startContext, setStartContext] = useState<StartContext | null>(null);
  const [autoReturnSeconds, setAutoReturnSeconds] = useState<number | null>(null);
  const [stayOnTimeline, setStayOnTimeline] = useState(false);
  const [timelineDate, setTimelineDate] = useState(() => tokyoDayStart());
  const [timelineDays, setTimelineDays] = useState<1 | 3>(1);
  const nfcHealth = useNfcBridgeHealth(true);

  const load = useCallback(async (quiet = false) => {
    if (loadInFlight.current) return false;
    loadInFlight.current = true;
    if (!quiet) setRefreshing(true);
    if (!dataRef.current) setLoading(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4000);
    try {
      const query = view === "timeline" ? `?from=${encodeURIComponent(timelineDate.toISOString())}&days=${timelineDays}` : "";
      const response = await fetch(`/api/dashboard${query}`, { cache: "no-store", signal: controller.signal });
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
      dataRef.current = next;
      setData(next);
      setLastSuccessfulSync(new Date());
      setSyncState("healthy");
      return true;
    } catch {
      setSyncState("stale");
      if (!quiet) setToast({ message: "更新できませんでした。前回取得した情報を表示しています", tone: "error" });
      return false;
    } finally {
      window.clearTimeout(timeout);
      loadInFlight.current = false;
      setLoading(false);
      if (!quiet) setRefreshing(false);
    }
  }, [timelineDate, timelineDays, view]);

  useEffect(() => {
    load();
    setIsOnline(navigator.onLine);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) void load(true);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const handleOffline = () => { setIsOnline(false); setSyncState("stale"); };
    const handleOnline = () => { setIsOnline(true); void load(); };
    const handleVisibility = () => { if (document.visibilityState === "visible" && navigator.onLine) void load(true); };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
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
    setStayOnTimeline(false);
    setStartContext({ vehicleId: params.get("vehicleId") ?? "", employeeId: params.get("employeeId") ?? "" });
    window.history.replaceState({}, "", "/timeline");
  }, [view]);

  useEffect(() => {
    if (view !== "timeline" || !startContext || stayOnTimeline) { setAutoReturnSeconds(null); return; }
    const duration = 5_000;
    const startedAt = Date.now();
    setAutoReturnSeconds(5);
    const stopAutoReturn = () => setStayOnTimeline(true);
    window.addEventListener("pointerdown", stopAutoReturn, { once: true });
    window.addEventListener("keydown", stopAutoReturn, { once: true });
    const interval = window.setInterval(() => setAutoReturnSeconds(Math.max(0, Math.ceil((duration - (Date.now() - startedAt)) / 1000))), 250);
    const timeout = window.setTimeout(() => window.location.assign("/"), duration);
    return () => {
      window.removeEventListener("pointerdown", stopAutoReturn);
      window.removeEventListener("keydown", stopAutoReturn);
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [startContext, stayOnTimeline, view]);

  useEffect(() => {
    if (!undoReturn) return;
    const remaining = undoReturn.expiresAt - Date.now();
    if (remaining <= 0) { setUndoReturn(null); return; }
    const timer = window.setTimeout(() => setUndoReturn(null), remaining);
    return () => window.clearTimeout(timer);
  }, [undoReturn]);

  useEffect(() => {
    if (!toast || toast.tone !== "success") return;
    const timer = window.setTimeout(() => setToast(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const mutate = useCallback(async (body: object, success: string) => {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPendingAction(true);
    const operationId = crypto.randomUUID();
    const send = async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 10_000);
      try {
        return await fetch("/api/dashboard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationId, actorEmployeeId: employee?.id, ...body }), signal: controller.signal });
      } finally {
        window.clearTimeout(timeout);
      }
    };
    try {
      let response: Response;
      try {
        response = await send();
      } catch {
        if (!navigator.onLine) throw new Error("OFFLINE");
        response = await send();
      }
      const result = await response.json().catch(() => ({ message: "サーバーから正しい応答を受信できませんでした" }));
      setToast({ message: response.ok ? success : result.message, tone: response.ok ? "success" : "error" });
      await load(true);
      return response.ok;
    } catch (error) {
      await load(true);
      setToast({ message: error instanceof Error && error.message === "OFFLINE" ? "オフラインのため操作できません。接続復旧後に再試行してください" : "通信結果を確認できませんでした。最新状態を再取得しました。内容を確認して再試行してください", tone: "error" });
      return false;
    } finally {
      pendingRef.current = false;
      setPendingAction(false);
    }
  }, [employee?.id, load]);

  if (loading && !data) return <Loading view={view} />;
  if (!data) return <InitialLoadError view={view} refreshing={refreshing} onRetry={() => void load()} />;
  const activeTrips = data.trips.filter((trip) => trip.status === "IN_USE");
  const activeEmployees = data.employees.filter((person) => person.active);
  const activeVehicles = data.vehicles.filter((vehicle) => vehicle.active);
  const available = activeVehicles.filter((vehicle) => vehicle.status === "AVAILABLE");
  const parkedCount = data.spots.reduce((count, spot) => count + (spot.vehicle ? 1 : 0), 0);
  const confirmedTrip = startContext ? data.trips.find((trip) => trip.vehicleId === startContext.vehicleId && trip.employeeId === startContext.employeeId && trip.status === "IN_USE") : undefined;
  const openStart = (vehicle?: Vehicle) => { setSelectedVehicleId(vehicle?.id ?? ""); setDialog("start"); };
  const openEnd = (trip: Trip) => { setReturnTrip(trip); setDialog("end"); };
  const openParkingReturn = (spot: ParkingSpot) => { setReturnSpot(spot); setDialog("parkingReturn"); };
  const openMoveVehicle = (vehicle: Vehicle) => { setMovingVehicle(vehicle); setDialog("moveVehicle"); };
  const openEdit = (trip: Trip) => { if (view === "timeline" && startContext) setStayOnTimeline(true); setEditTrip(trip); setDialog("edit"); };
  const completeReturn = async (trip: Trip, spotId: string) => {
    const currentVehicle = data.vehicles.find((vehicle) => vehicle.id === trip.vehicleId);
    if (!currentVehicle) return false;
    const ok = await mutate({ action: "end", tripId: trip.id, tripVersion: trip.version, vehicleId: trip.vehicleId, vehicleVersion: currentVehicle.version, spotId, actorName: employee?.name ?? "共用端末" }, "返却を登録しました。車両は利用可能です");
    if (ok) setUndoReturn({ tripId: trip.id, vehicleId: trip.vehicleId, vehicleName: trip.vehicle.name, expiresAt: Date.now() + 5 * 60_000 });
    return ok;
  };
  const undoLastReturn = async () => {
    if (!undoReturn) return;
    const ok = await mutate({ action: "undoReturn", tripId: undoReturn.tripId, vehicleId: undoReturn.vehicleId, actorName: employee?.name ?? "共用端末" }, `${undoReturn.vehicleName}の返却を取り消し、利用中へ戻しました`);
    if (ok) setUndoReturn(null);
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
            <SystemStatus syncState={syncState} lastSuccessfulSync={lastSuccessfulSync} nfcStatus={nfcHealth} refreshing={refreshing} onRefresh={() => void load()} />
            {employee ? <button onClick={clearEmployee} title="クリックして利用者選択を解除" className="hidden items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800 lg:flex"><UserRound className="size-4" /><span>{employee.name}</span><X className="size-3.5" /></button> : <div className="hidden items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800 lg:flex"><AlertTriangle className="size-4" /><span>利用者未選択</span></div>}
            <Button variant="ghost" onClick={() => setDialog("nfc")}><Nfc className="size-5" /><span className="hidden sm:inline">NFC読取</span></Button>
            <button aria-label="最新情報に更新" aria-busy={refreshing} disabled={refreshing} onClick={() => void load()} className="grid size-11 place-items-center rounded-xl border border-slate-200 bg-white disabled:opacity-50"><RefreshCw className={cn("size-4", refreshing && "animate-spin")} /></button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] space-y-5 p-4 pb-28 md:p-8">
        {!isOnline ? <Card role="alert" className="flex flex-wrap items-center gap-3 border-amber-300 bg-amber-50 p-3 text-amber-950"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-amber-500 text-white"><AlertTriangle className="size-4" /></span><div className="mr-auto"><p className="text-sm font-black">オフラインです</p><p className="text-xs text-amber-800">表示中の情報は更新されません。接続が戻ると自動的に再同期します。</p></div></Card> : null}
        {syncState === "stale" ? <Card role="alert" className="flex flex-wrap items-center gap-3 border-rose-300 bg-rose-50 p-3 text-rose-950"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-rose-600 text-white"><AlertTriangle className="size-4" /></span><div className="mr-auto min-w-0"><p className="text-sm font-black">自動更新が停止しています</p><p className="text-xs text-rose-800">{lastSuccessfulSync ? `最終更新 ${jpTimeSeconds.format(lastSuccessfulSync)}。前回取得した情報を表示しています。` : "最新情報を取得できていません。"}</p></div><Button variant="danger" disabled={refreshing} onClick={() => void load()}>{refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}{refreshing ? "再接続中…" : "再接続"}</Button></Card> : null}
        <OperationalAlerts data={data} nfcStatus={nfcHealth} />
        {undoReturn ? <Card className="flex flex-wrap items-center gap-3 border-amber-300 bg-amber-50 p-3 text-amber-950"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-amber-500 text-white"><AlertTriangle className="size-4" /></span><div className="mr-auto min-w-0"><p className="text-sm font-black">{undoReturn.vehicleName}を返却しました</p><p className="text-xs text-amber-800">間違えた場合は5分以内に取り消せます</p></div><Button variant="secondary" className="border-amber-300 bg-white text-amber-900 hover:bg-amber-100" disabled={pendingAction} onClick={undoLastReturn}>返却を取り消す</Button><button type="button" aria-label="返却取消の案内を閉じる" onClick={() => setUndoReturn(null)} className="grid size-9 place-items-center rounded-lg text-amber-700 hover:bg-amber-100"><X className="size-4" /></button></Card> : null}
        {view === "parking" ? <section className="space-y-3 md:-mt-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm md:px-4">
            <div className="mr-auto min-w-64"><h2 className="text-sm font-black">{parkingMode === "map" ? "社屋隣接駐車場 配置図" : "利用中の車両"}</h2><p className="text-[11px] text-slate-500">{parkingMode === "map" ? "駐車中の車をタップして利用開始 ・ 空き区画をタップして返却" : "利用者・開始時刻・返却予定を確認し、予定変更や返却登録ができます"}</p></div>
            <div aria-live="polite" className="flex flex-wrap items-center gap-2 text-xs font-bold"><span className="text-rose-700">駐車中 {parkedCount}台</span><span className="text-slate-300">｜</span><span className="text-blue-700">利用中 {activeTrips.length}台</span><span className="px-1 font-normal text-slate-500">{jpDate.format(new Date())} ・ 自動更新 5秒</span></div>
            <ViewSwitch value={parkingMode} onChange={setParkingMode} first={{ value: "map", label: "配置図", icon: <MapIcon className="size-4" /> }} second={{ value: "active", label: "利用中一覧", icon: <CarFront className="size-4" /> }} compact />
          </div>
          {parkingMode === "map" ? <ParkingMap data={data} changedVehicleIds={changedVehicleIds} mutate={mutate} openStart={openStart} openReturn={openParkingReturn} openMove={openMoveVehicle} actorName={employee?.name ?? "共用端末"} /> : <ActiveVehicleList trips={activeTrips} openEdit={openEdit} openEnd={openEnd} />}
        </section> : null}

        {view === "timeline" ? <>
          {startContext ? <Card className="flex flex-wrap items-center gap-3 border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-emerald-600 text-white"><Check className="size-5" /></span>
            <div className="min-w-0 flex-1"><p className="font-black">利用開始を登録しました</p><p className="mt-0.5 text-sm text-emerald-700">{confirmedTrip ? `${confirmedTrip.vehicle.name} ・ ${confirmedTrip.employee.name} ・ ${formatDateTime(confirmedTrip.actualStart ?? confirmedTrip.plannedStart)}〜${formatDateTime(confirmedTrip.plannedEnd)}` : "登録内容がタイムラインに反映されています。"}</p><p className="mt-1 text-xs font-bold text-emerald-800">{stayOnTimeline ? "自動移動を停止しました。続けて予定を修正できます。" : `${autoReturnSeconds ?? 5}秒後に駐車場へ戻ります。画面を操作すると停止します。`}</p></div>
            <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setStayOnTimeline(true)} disabled={stayOnTimeline} className="rounded-xl px-3 py-2 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100 disabled:text-emerald-500">タイムラインに留まる</button><Link href="/" className="rounded-xl border border-emerald-300 bg-white px-4 py-2 text-sm font-bold text-emerald-800 transition hover:bg-emerald-100">今すぐ駐車場へ戻る</Link></div>
          </Card> : null}
          <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            {timelineMode === "chart" ? <Card className="min-w-0 overflow-hidden"><TimelinePanelHeader mode={timelineMode} onChange={setTimelineMode} /><Timeline data={data} mutate={mutate} openStart={openStart} openEdit={openEdit} actorName={employee?.name ?? "共用端末"} highlightTripId={confirmedTrip?.id} timelineDate={timelineDate} timelineDays={timelineDays} setTimelineDate={setTimelineDate} setTimelineDays={setTimelineDays} /></Card> : <TimelineList trips={data.trips} openEdit={openEdit} mode={timelineMode} onChange={setTimelineMode} />}
            <ActiveTripsPanel trips={activeTrips} openEnd={openEnd} />
          </section>
        </> : null}

        {view === "settingsEmployees" || view === "settingsVehicles" ? <AdminGate>
          <div className="space-y-5">
            <PageHeading eyebrow="管理設定" title={view === "settingsEmployees" ? "社員登録" : "車両登録"} description={view === "settingsEmployees" ? "利用者となる社員と社員証のNFCタグを登録します。" : "利用する社用車と車両のNFCタグを登録します。"} />
            <SettingsNavigation view={view} />
            <div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-xs font-bold text-blue-600">日常管理</p><h3 className="mt-0.5 text-lg font-black">{view === "settingsEmployees" ? "社員情報" : "車両情報"}</h3></div><p className="text-xs text-slate-500">検索・登録・変更をこの一覧から行えます</p></div>
            <SettingsPanelV2 kind={view === "settingsEmployees" ? "employee" : "vehicle"} data={data} mutate={mutate} />
            <AdminToolsPanel />
          </div>
        </AdminGate> : null}
      </main>

      {dialog === "nfc" && <NfcDialog employees={activeEmployees} vehicles={activeVehicles} onEmployee={(person) => { selectEmployee(person); setToast({ message: `${person.name}さんを認証しました`, tone: "success" }); setDialog(null); }} onVehicle={(vehicle) => { setDialog(null); const trip = activeTrips.find((item) => item.vehicleId === vehicle.id); if (trip) openEnd(trip); else openStart(vehicle); }} onClose={() => setDialog(null)} />}
      {dialog === "start" && <StartDialog submitting={pendingAction} employees={activeEmployees} vehicles={available} trips={data.trips} initialEmployee={employee?.active ? employee : null} initialVehicleId={selectedVehicleId} onClose={() => setDialog(null)} onSubmit={async (values) => { const identifiedEmployee = activeEmployees.find((person) => person.id === values.employeeId) ?? null; const scheduled = values.plannedStart !== null; const ok = await mutate(scheduled ? { action: "reserve", employeeId: values.employeeId, vehicleId: values.vehicleId, plannedStart: values.plannedStart!, minutes: values.minutes, actorName: values.employeeName, actorEmployeeId: values.employeeId } : { action: "start", employeeId: values.employeeId, vehicleId: values.vehicleId, minutes: values.minutes, actorName: values.employeeName, actorEmployeeId: values.employeeId }, scheduled ? "予約を登録しました" : "利用を開始しました"); if (ok && identifiedEmployee) { selectEmployee(identifiedEmployee); setDialog(null); if (!scheduled) window.location.assign(`/timeline?started=1&vehicleId=${encodeURIComponent(values.vehicleId)}&employeeId=${encodeURIComponent(values.employeeId)}`); } }} />}
      {dialog === "end" && returnTrip && <EndDialog submitting={pendingAction} trip={returnTrip} spots={data.spots} onClose={() => setDialog(null)} onSubmit={async (spotId) => { const ok = await completeReturn(returnTrip, spotId); if (ok) setDialog(null); }} />}
      {dialog === "parkingReturn" && returnSpot && <ParkingReturnDialog submitting={pendingAction} spot={returnSpot} trips={activeTrips} vehicles={data.vehicles} onClose={() => setDialog(null)} onSubmit={async (trip) => { const ok = await completeReturn(trip, returnSpot.id); if (ok) { setDialog(null); setReturnSpot(null); } }} />}
      {dialog === "moveVehicle" && movingVehicle && <MoveVehicleDialog submitting={pendingAction} vehicle={movingVehicle} spots={data.spots} onClose={() => setDialog(null)} onSubmit={async (spotId) => { const spot = data.spots.find((item) => item.id === spotId); const ok = await mutate({ action: "moveVehicle", vehicleId: movingVehicle.id, version: movingVehicle.version, spotId, actorName: employee?.name ?? "共用端末" }, `区画${spot?.code ?? ""}へ移動しました`); if (ok) setDialog(null); }} />}
      {dialog === "edit" && editTrip && <EditTripDialog submitting={pendingAction} trip={editTrip} onClose={() => setDialog(null)} onAdjust={async (minutes) => { const direction = minutes > 0 ? "延長" : "短縮"; const ok = await mutate({ action: "adjustTrip", tripId: editTrip.id, version: editTrip.version, minutes, actorName: employee?.name ?? "共用端末" }, `${Math.abs(minutes)}分${direction}しました`); if (ok) { setDialog(null); if (startContext) setStayOnTimeline(false); } }} onSetEnd={async (plannedEnd) => { const ok = await mutate({ action: "setTripEnd", tripId: editTrip.id, version: editTrip.version, plannedEnd, actorName: employee?.name ?? "共用端末" }, `終了日時を${formatDateTime(plannedEnd)}へ変更しました`); if (ok) { setDialog(null); if (startContext) setStayOnTimeline(false); } }} onCancel={async () => { const ok = await mutate({ action: "cancelTrip", tripId: editTrip.id, version: editTrip.version, actorName: employee?.name ?? "共用端末" }, "予約を取り消しました"); if (ok) setDialog(null); }} />}
      {pendingAction ? <div className="fixed left-0 top-0 z-[80] h-1 w-full overflow-hidden bg-blue-100"><div className="h-full w-1/2 animate-pulse bg-blue-600" /></div> : null}
      {toast ? <div role={toast.tone === "error" ? "alert" : "status"} className={cn("fixed bottom-24 left-1/2 z-[70] flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white shadow-2xl md:bottom-5", toast.tone === "error" ? "bg-rose-700" : "bg-slate-950")} >{toast.tone === "error" ? <AlertTriangle className="size-4 shrink-0" /> : <Check className="size-4 shrink-0" />}<span>{toast.message}</span><button type="button" aria-label={toast.tone === "error" ? "エラー通知を閉じる" : "完了通知を閉じる"} onClick={() => setToast(null)} className="ml-1 grid size-7 shrink-0 place-items-center rounded-lg bg-white/15 hover:bg-white/25"><X className="size-3.5" /></button></div> : null}
      <Navigation view={view} className="fixed inset-x-3 bottom-3 z-40 flex rounded-2xl border border-slate-200 bg-white/95 p-1.5 shadow-2xl backdrop-blur md:hidden" />
    </div>
  );
}

function Loading({ view }: { view: DashboardView }) { return <div className="min-h-screen bg-[#f4f7fb]"><header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3 px-4 py-3 md:px-8"><div className="flex items-center gap-3"><div className="grid size-11 place-items-center rounded-2xl bg-blue-600 text-white"><CarFront /></div><div><p className="text-lg font-black">FleetFlow</p><p className="hidden text-xs text-slate-500 sm:block">社用車 利用・駐車管理</p></div></div><Navigation view={view} className="hidden md:flex" /></div></header><main className="mx-auto max-w-[1600px] space-y-5 p-4 pb-28 md:p-8"><div className="h-7 w-52 animate-pulse rounded-lg bg-slate-200" /><div className="grid gap-3 sm:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}</div><div className="grid min-h-64 place-items-center rounded-2xl border border-slate-200 bg-white"><div className="text-center"><RefreshCw className="mx-auto size-8 animate-spin text-blue-600" /><p className="mt-3 text-sm font-bold text-slate-600">車両情報を読み込み中</p></div></div></main><Navigation view={view} className="fixed inset-x-3 bottom-3 z-40 flex rounded-2xl border border-slate-200 bg-white/95 p-1.5 shadow-2xl backdrop-blur md:hidden" /></div>; }

function InitialLoadError({ view, refreshing, onRetry }: { view: DashboardView; refreshing: boolean; onRetry: () => void }) {
  return <div className="min-h-screen bg-[#f4f7fb]"><header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3 px-4 py-3 md:px-8"><div className="flex items-center gap-3"><div className="grid size-11 place-items-center rounded-2xl bg-blue-600 text-white"><CarFront /></div><p className="text-lg font-black">FleetFlow</p></div><Navigation view={view} className="hidden md:flex" /></div></header><main className="grid min-h-[calc(100vh-72px)] place-items-center p-4 pb-28"><Card role="alert" className="w-full max-w-lg p-6 text-center"><span className="mx-auto grid size-12 place-items-center rounded-full bg-rose-100 text-rose-700"><AlertTriangle className="size-6" /></span><h1 className="mt-4 text-xl font-black">FleetFlowに接続できません</h1><p className="mt-2 text-sm leading-6 text-slate-600">Dockerとデータベースの起動状態を確認してください。接続が戻ったら再試行できます。</p><Button className="mt-5 w-full" disabled={refreshing} onClick={onRetry}>{refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}{refreshing ? "接続中…" : "再接続"}</Button></Card></main><Navigation view={view} className="fixed inset-x-3 bottom-3 z-40 flex rounded-2xl border border-slate-200 bg-white/95 p-1.5 shadow-2xl backdrop-blur md:hidden" /></div>;
}

function OperationalAlerts({ data, nfcStatus }: { data: DashboardData; nfcStatus: NfcBridgeStatus }) {
  const now = Date.now();
  const overdue = data.trips.filter((trip) => trip.status === "IN_USE" && new Date(trip.plannedEnd).getTime() < now).length;
  const unlocated = data.vehicles.filter((vehicle) => vehicle.active && vehicle.status === "AVAILABLE" && !vehicle.parkingSpotId).length;
  const backupOld = !data.system.backupLatestAt || now - new Date(data.system.backupLatestAt).getTime() > 26 * 60 * 60_000;
  const verificationOld = !data.system.backupVerifiedAt || now - new Date(data.system.backupVerifiedAt).getTime() > 26 * 60 * 60_000;
  const nfcUnavailable = nfcStatus === "offline" || nfcStatus === "no-reader";
  const alerts = [
    overdue ? { label: `返却予定を超過 ${overdue}台`, href: "/timeline" } : null,
    unlocated ? { label: `駐車位置未確定 ${unlocated}台`, href: "/settings/vehicles?status=active" } : null,
    backupOld || verificationOld ? { label: backupOld ? "DBバックアップを確認できません" : "バックアップ復元確認が古くなっています", href: "/operations" } : null,
    nfcUnavailable ? { label: nfcStatus === "no-reader" ? "NFCリーダー未接続（手動操作可）" : "NFC連携ソフト停止（手動操作可）", href: "/settings/employees" } : null,
  ].filter((item): item is { label: string; href: string } => item !== null);
  if (alerts.length === 0) return null;
  return <Card role="status" className="flex flex-wrap items-center gap-2 border-amber-300 bg-amber-50 p-3"><span className="mr-1 inline-flex items-center gap-2 text-sm font-black text-amber-950"><AlertTriangle className="size-4" />確認が必要</span>{alerts.map((alert) => <Link key={alert.label} href={alert.href} className="rounded-full border border-amber-200 bg-white px-3 py-1.5 text-xs font-bold text-amber-900 hover:border-amber-400">{alert.label}</Link>)}</Card>;
}

function SystemStatus({ syncState, lastSuccessfulSync, nfcStatus, refreshing, onRefresh }: { syncState: SyncState; lastSuccessfulSync: Date | null; nfcStatus: NfcBridgeStatus; refreshing: boolean; onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const appHealthy = syncState === "healthy";
  const nfcLabel = nfcStatus === "ready" ? "NFC接続" : nfcStatus === "no-reader" ? "NFC未接続" : nfcStatus === "offline" ? "NFC手動" : "NFC確認中";
  const nfcHealthy = nfcStatus === "ready";
  return <div className="relative hidden lg:block">
    <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((current) => !current)} className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 transition hover:border-slate-300 hover:bg-white" title="システム状態の詳細を表示"><span className={cn("size-2 rounded-full", appHealthy ? "bg-emerald-500" : "bg-rose-500")} /><span className={cn("text-xs font-bold", appHealthy ? "text-emerald-700" : "text-rose-700")}>{appHealthy ? "正常" : "更新停止"}</span><span className="text-slate-300">｜</span><Nfc className={cn("size-3.5", nfcHealthy ? "text-emerald-600" : "text-amber-600")} /><span className={cn("text-xs font-bold", nfcHealthy ? "text-emerald-700" : "text-amber-700")}>{nfcLabel}</span>{open ? <ChevronUp className="size-3.5 text-slate-400" /> : <ChevronDown className="size-3.5 text-slate-400" />}</button>
    {open ? <div id={panelId} role="status" className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-80 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl"><div className="flex items-start justify-between gap-3"><div><p className="font-black">システム状態</p><p className="mt-0.5 text-[11px] text-slate-500">運用に必要な接続をまとめて確認できます</p></div><button type="button" aria-label="システム状態を閉じる" onClick={() => setOpen(false)} className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="size-4" /></button></div><div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-100 bg-slate-50/60 px-3"><StatusRow label="FleetFlow本体" value={appHealthy ? "接続済み" : "更新停止"} healthy={appHealthy} /><StatusRow label="データベース" value={appHealthy ? "接続済み" : "確認が必要"} healthy={appHealthy} /><StatusRow label="NFCリーダー" value={nfcLabel} healthy={nfcHealthy} warning={!nfcHealthy} /></div><p className="mt-3 text-xs text-slate-500">最終更新：{lastSuccessfulSync ? jpTimeSeconds.format(lastSuccessfulSync) : "確認中"}</p><Button variant="secondary" className="mt-3 w-full" disabled={refreshing} onClick={onRefresh}>{refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}{refreshing ? "確認中…" : "状態を再確認"}</Button></div> : null}
  </div>;
}

function StatusRow({ label, value, healthy, warning = false }: { label: string; value: string; healthy: boolean; warning?: boolean }) {
  return <div className="flex items-center justify-between gap-3 py-2.5 text-xs"><span className="font-bold text-slate-600">{label}</span><span className={cn("flex items-center gap-1.5 font-black", healthy ? "text-emerald-700" : warning ? "text-amber-700" : "text-rose-700")}><i className={cn("size-2 rounded-full", healthy ? "bg-emerald-500" : warning ? "bg-amber-500" : "bg-rose-500")} />{value}</span></div>;
}

function Navigation({ view, className }: { view: DashboardView; className?: string }) {
  const links: { id: "parking" | "timeline" | "settings" | "operations"; href: string; label: string; icon: React.ReactNode }[] = [
    { id: "parking", href: "/", label: "駐車場", icon: <LayoutGrid className="size-4" /> },
    { id: "timeline", href: "/timeline", label: "タイムライン", icon: <Clock3 className="size-4" /> },
    { id: "settings", href: "/settings/employees", label: "設定", icon: <Settings className="size-4" /> },
    { id: "operations", href: "/operations", label: "履歴", icon: <Archive className="size-4" /> },
  ];
  return <nav aria-label="メインメニュー" className={cn("items-center justify-center gap-1", className)}>{links.map((link) => { const active = link.id === "settings" ? view.startsWith("settings") : view === link.id; return <Link key={link.id} href={link.href} aria-current={active ? "page" : undefined} className={cn("flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 whitespace-nowrap rounded-xl px-1 text-[10px] font-bold transition md:min-h-10 md:flex-none md:flex-row md:gap-2 md:px-4 md:text-xs", active ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900")}>{link.icon}<span className="max-w-full truncate max-[300px]:hidden">{link.label}</span></Link>; })}</nav>;
}

function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div><p className="text-xs font-bold text-blue-600">{eyebrow}</p><h2 className="mt-1 text-2xl font-black">{title}</h2><p className="mt-1 text-sm text-slate-500">{description}</p></div>;
}

function ActiveTripsPanel({ trips, openEnd }: { trips: Trip[]; openEnd: (trip: Trip) => void }) {
  return <Card className="p-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="font-black">返却対象</h2><p className="text-xs text-slate-500">返却すると即時利用可能になります</p></div><span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">{trips.length}件</span></div><div className="space-y-3">{trips.length === 0 ? <Empty label="現在、返却対象の車両はありません" /> : trips.map((trip) => { const overdue = new Date(trip.plannedEnd).getTime() < Date.now(); return <div key={trip.id} className={cn("rounded-2xl border p-4", overdue ? "border-rose-300 bg-rose-50/50" : "border-slate-200")}><div className="flex items-start justify-between"><div><p className="font-black">{trip.vehicle.name}</p><p className="mt-0.5 text-xs text-slate-500">{trip.employee.name} ・ {trip.employee.department}</p></div>{overdue ? <span className="rounded-full bg-rose-100 px-2 py-1 text-[10px] font-bold text-rose-700">返却超過</span> : null}</div><div className={cn("my-3 flex items-center gap-2 text-xs", overdue ? "font-bold text-rose-700" : "text-slate-600")}><Clock3 className="size-4" />返却予定 {formatDateTime(trip.plannedEnd)}</div><Button className="w-full" variant="secondary" onClick={() => openEnd(trip)}><LogOut className="size-4" />返却登録</Button></div>; })}</div></Card>;
}
function Legend({ color, label }: { color: string; label: string }) { return <span className="flex items-center gap-1.5"><i className={cn("size-2 rounded-full", color)} />{label}</span>; }
function Empty({ label }: { label: string }) { return <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-400">{label}</div>; }

function ViewSwitch<T extends string>({ value, onChange, first, second, compact = false }: { value: T; onChange: (value: T) => void; first: { value: T; label: string; icon: React.ReactNode }; second: { value: T; label: string; icon: React.ReactNode }; compact?: boolean }) {
  return <div className="inline-flex w-fit rounded-xl border border-slate-200 bg-white p-1 shadow-sm">{[first, second].map((item) => <button key={item.value} type="button" onClick={() => onChange(item.value)} aria-pressed={value === item.value} className={cn("inline-flex items-center gap-2 rounded-lg font-bold transition", compact ? "min-h-7 px-2.5 text-xs" : "min-h-10 px-4 text-sm", value === item.value ? "bg-slate-900 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50")} >{item.icon}{item.label}</button>)}</div>;
}

function TimelinePanelHeader({ mode, onChange }: { mode: "chart" | "list"; onChange: (mode: "chart" | "list") => void }) {
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-100 px-4 py-2.5"><ViewSwitch value={mode} onChange={onChange} first={{ value: "chart", label: "タイムライン", icon: <Clock3 className="size-4" /> }} second={{ value: "list", label: "予定一覧", icon: <List className="size-4" /> }} compact /><p className="mr-auto text-xs text-slate-500">{mode === "chart" ? "ドラッグまたは予定をタップして時間を変更" : "予定を選ぶと終了時間の変更や取消ができます"}</p><div className="flex shrink-0 gap-3 text-xs"><Legend color="bg-blue-500" label="利用中" /><Legend color="bg-violet-500" label="予約" /><Legend color="bg-slate-400" label="完了" /></div></div>;
}

function ActiveVehicleList({ trips, openEdit, openEnd }: { trips: Trip[]; openEdit: (trip: Trip) => void; openEnd: (trip: Trip) => void }) {
  const now = Date.now();
  return <Card className="overflow-hidden">
    {trips.length === 0 ? <div className="p-5"><Empty label="現在利用中の車両はありません" /></div> : <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{trips.map((trip) => {
      const overdue = new Date(trip.plannedEnd).getTime() < now;
      return <article key={trip.id} className={cn("flex min-h-36 flex-col rounded-xl border bg-white p-3 [content-visibility:auto]", overdue ? "border-rose-300 bg-rose-50/40" : "border-slate-200")}>
        <div className="flex items-start gap-2">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-blue-50"><CarFront className="size-4" style={{ color: trip.vehicle.color }} /></span>
          <div className="min-w-0 flex-1"><h3 className="truncate text-sm font-black">{trip.vehicle.name}</h3><p className="truncate text-xs font-bold text-slate-500">{formatPlateShort(trip.vehicle.plateNumber)} ・ {trip.vehicle.code}</p></div>
          {overdue ? <span className="shrink-0 rounded-full bg-rose-100 px-2 py-1 text-[9px] font-bold text-rose-700">返却超過</span> : null}
        </div>
        <p className="mt-2 flex min-w-0 items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs"><span className="shrink-0 text-[9px] font-bold text-slate-400">利用者</span><strong className="truncate text-slate-700">{trip.employee.name}</strong></p>
        <div className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-100 pt-2 text-xs"><div><p className="text-[9px] font-bold text-slate-400">利用開始</p><p className="font-black text-slate-700">{formatTime(trip.actualStart ?? trip.plannedStart)}</p></div><div><p className="text-[9px] font-bold text-slate-400">返却予定</p><p className={cn("font-black", overdue ? "text-rose-700" : "text-slate-700")}>{formatTime(trip.plannedEnd)}</p></div></div>
        <div className="mt-2 flex gap-2 border-t border-slate-100 pt-2"><Button variant="ghost" className="min-h-8 flex-1 px-2 text-xs" onClick={() => openEdit(trip)}><Pencil className="size-3.5" />予定変更</Button><Button className="min-h-8 flex-1 px-2 text-xs" onClick={() => openEnd(trip)}><LogOut className="size-3.5" />返却登録</Button></div>
      </article>;
    })}</div>}
  </Card>;
}

function TimelineList({ trips, openEdit, mode, onChange }: { trips: Trip[]; openEdit: (trip: Trip) => void; mode: "chart" | "list"; onChange: (mode: "chart" | "list") => void }) {
  const ordered = [...trips].sort((left, right) => new Date(timelineStartOf(left)).getTime() - new Date(timelineStartOf(right)).getTime());
  const now = Date.now();
  return <Card className="overflow-hidden"><TimelinePanelHeader mode={mode} onChange={onChange} />{ordered.length === 0 ? <div className="p-5"><Empty label="この期間の利用予定はありません" /></div> : <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">{ordered.map((trip) => {
    const overdue = trip.status === "IN_USE" && new Date(trip.plannedEnd).getTime() < now;
    const label = trip.status === "IN_USE" ? overdue ? "返却超過" : "利用中" : trip.status === "RESERVED" ? "予約" : "完了";
    const displayStart = timelineStartOf(trip);
    const displayEnd = timelineEndOf(trip, now);
    const liveOverdue = trip.status === "IN_USE" && new Date(trip.plannedEnd).getTime() < now;
    return <button key={trip.id} type="button" disabled={trip.status === "COMPLETED"} onClick={() => openEdit(trip)} className="min-h-28 rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-blue-300 hover:bg-blue-50/40 hover:shadow-sm disabled:cursor-default disabled:hover:border-slate-200 disabled:hover:bg-white disabled:hover:shadow-none"><span className="flex items-start gap-2"><span className={cn("mt-1 size-2.5 shrink-0 rounded-full", overdue ? "bg-rose-500" : trip.status === "IN_USE" ? "bg-blue-500" : trip.status === "RESERVED" ? "bg-violet-500" : "bg-slate-300")} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-black">{trip.vehicle.name}</span><span className="mt-0.5 block truncate text-xs text-slate-500">{trip.employee.name}</span></span><span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-bold", overdue ? "bg-rose-100 text-rose-700" : trip.status === "IN_USE" ? "bg-blue-50 text-blue-700" : trip.status === "RESERVED" ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-500")}>{label}</span>{trip.status !== "COMPLETED" ? <ChevronRight className="mt-1 size-4 shrink-0 text-slate-300" /> : null}</span><span className="mt-3 block border-t border-slate-100 pt-2 text-xs font-bold text-slate-600">{trip.status === "COMPLETED" ? "実績 " : liveOverdue ? "超過中 " : "予定 "}{formatDateTime(displayStart)}〜{liveOverdue ? `現在 ${formatDateTime(displayEnd)}` : formatDateTime(displayEnd)}</span></button>;
  })}</div>}</Card>;
}

function SettingsNavigation({ view }: { view: "settingsEmployees" | "settingsVehicles" }) {
  return <nav aria-label="設定メニュー" className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm"><Link href="/settings/employees" className={cn("rounded-lg px-5 py-2 text-sm font-bold transition", view === "settingsEmployees" ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50")}>社員登録</Link><Link href="/settings/vehicles" className={cn("rounded-lg px-5 py-2 text-sm font-bold transition", view === "settingsVehicles" ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50")}>車両登録</Link></nav>;
}

function AdminToolsPanel() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return <Card className="overflow-hidden border-slate-200"><button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((current) => !current)} className="flex min-h-16 w-full items-center gap-3 px-4 text-left transition hover:bg-slate-50"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600"><Settings className="size-5" /></span><span className="mr-auto min-w-0"><span className="block text-sm font-black">管理・緊急時ツール</span><span className="block text-xs text-slate-500">障害時に使用する空白用紙の印刷</span></span>{open ? <ChevronUp className="size-5 text-slate-400" /> : <ChevronDown className="size-5 text-slate-400" />}</button>{open ? <div id={panelId} className="border-t border-slate-100 bg-amber-50/50 p-4"><div className="flex flex-wrap items-center gap-3"><div className="mr-auto min-w-64"><p className="flex items-center gap-2 font-black text-amber-950"><Printer className="size-5" />緊急時印刷</p><p className="mt-0.5 text-xs text-amber-800">障害時に手書きで運用できる、日付・予定・駐車位置が空欄のA4横用紙です。</p></div><Link href="/print/parking?print=1" target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-amber-300 bg-white px-4 text-sm font-bold text-amber-900 shadow-sm transition hover:bg-amber-100"><MapIcon className="size-4" />空白の配置図を印刷</Link><Link href="/print/timeline?print=1" target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800"><Clock3 className="size-4" />空白のタイムラインを印刷</Link></div></div> : null}</Card>;
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
  const visibleTripsByVehicle = new Map<string, Trip[]>();
  for (const trip of data.trips) {
    if (new Date(timelineEndOf(trip, now.getTime())) <= timelineStart || new Date(timelineStartOf(trip)) >= timelineEnd) continue;
    const current = visibleTripsByVehicle.get(trip.vehicleId);
    if (current) current.push(trip); else visibleTripsByVehicle.set(trip.vehicleId, [trip]);
  }
  const parkingSpotByVehicle = new Map(data.spots.flatMap((spot) => spot.vehicle ? [[spot.vehicle.id, spot] as const] : []));
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
    if (trip.status !== "RESERVED") return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = { trip, x: event.clientX };
    moved.current = false;
  };
  const onMove = (event: React.PointerEvent, trip: Trip) => {
    if (trip.status !== "RESERVED" || drag.current?.trip.id !== trip.id) return;
    const delta = Math.round((event.clientX - drag.current.x) / pxPerMinute / 15) * 15;
    if (delta !== 0) moved.current = true;
    setDraft((current) => ({ ...current, [trip.id]: delta }));
  };
  const endDrag = async (trip: Trip) => {
    if (trip.status !== "RESERVED" || drag.current?.trip.id !== trip.id) return;
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
        const trips = visibleTripsByVehicle.get(vehicle.id) ?? [];
        const isHighlightedVehicle = trips.some((trip) => trip.id === highlightTripId);
        const parkingSpot = parkingSpotByVehicle.get(vehicle.id);
        const locationLabel = vehicle.status === "IN_USE" ? "利用中" : vehicle.status === "MAINTENANCE" ? "整備中" : parkingSpot ? formatSpotLabel(parkingSpot.code) : "位置未設定";
        return <div ref={isHighlightedVehicle ? highlightedRow : undefined} key={vehicle.id} className={cn("flex h-[62px] border-b border-slate-100 [content-visibility:auto] [contain-intrinsic-size:62px] last:border-0", isHighlightedVehicle && "bg-amber-50 ring-2 ring-inset ring-amber-300")}>
          <button onClick={() => vehicle.active && vehicle.status === "AVAILABLE" && openStart(vehicle)} className={cn("sticky left-0 z-20 flex w-32 shrink-0 items-center gap-2 border-r border-slate-200 bg-white px-3 text-left hover:bg-slate-50", isHighlightedVehicle && "bg-amber-100", !vehicle.active && "opacity-50")}>
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: vehicle.color }} /><span className="min-w-0 flex-1"><span className="flex min-w-0 items-center gap-1"><b className="min-w-0 flex-1 truncate text-xs">{vehicle.name}</b>{isHighlightedVehicle ? <small className="shrink-0 rounded bg-amber-500 px-1 py-0.5 text-[8px] font-black text-white">登録</small> : null}</span><small title={`${formatPlateShort(vehicle.plateNumber)} ・ ${locationLabel}`} className={cn("block truncate text-[9px] font-bold", vehicle.status === "IN_USE" ? "text-blue-600" : parkingSpot ? "text-emerald-600" : "text-slate-500")}>{formatPlateShort(vehicle.plateNumber)} ・ {locationLabel}</small></span>
          </button>
          <div className="relative" style={{ width: timelineWidth, ...rowGridStyle }}>
            {includesNow ? <span className="pointer-events-none absolute inset-y-0 z-[1] w-0.5 bg-rose-400/70" style={{ left: nowMinute * pxPerMinute }} /> : null}
            {trips.map((trip) => {
              const delta = draft[trip.id] ?? 0;
              const displayStart = timelineStartOf(trip);
              const displayEnd = timelineEndOf(trip, now.getTime());
              const liveOverdue = trip.status === "IN_USE" && new Date(trip.plannedEnd).getTime() < now.getTime();
              const start = getMinute(displayStart) + delta;
              const duration = Math.max(15, (new Date(displayEnd).getTime() - new Date(displayStart).getTime()) / 60_000);
              const visibleStart = Math.max(0, start);
              const visibleEnd = Math.min(timelineMinutes, start + duration);
              const visibleDuration = Math.max(0, visibleEnd - visibleStart);
              const continuesBefore = start < 0;
              const continuesAfter = start + duration > timelineMinutes;
              const color = trip.status === "IN_USE" ? "bg-blue-500" : trip.status === "COMPLETED" ? "bg-slate-400" : "bg-violet-500";
              const isHighlighted = trip.id === highlightTripId;
              if (visibleDuration <= 0) return null;
              return <button ref={isHighlighted ? highlightedTrip : undefined} key={trip.id} title={`${trip.employee.name} ${trip.status === "COMPLETED" ? "実績" : "予定"} ${formatDateTime(displayStart)}–${formatDateTime(displayEnd)}`} onClick={() => { if (moved.current) { moved.current = false; return; } if (trip.status !== "COMPLETED") openEdit(trip); }} onPointerDown={(e) => beginDrag(e, trip)} onPointerMove={(e) => onMove(e, trip)} onPointerUp={() => endDrag(trip)} className={cn("absolute top-2 z-[2] h-11 touch-none select-none overflow-hidden rounded-xl px-3 text-left text-white shadow-sm", color, trip.status === "RESERVED" && "cursor-grab active:cursor-grabbing", isHighlighted && "z-10 ring-4 ring-amber-300 shadow-xl animate-pulse")} style={{ left: visibleStart * pxPerMinute, width: visibleDuration * pxPerMinute }}>
                <span className="block truncate text-xs font-black">{continuesBefore ? "◀ 継続 ・ " : ""}{isHighlighted ? "登録済 ・ " : ""}{trip.employee.name}{continuesAfter ? " ・ 翌日へ ▶" : ""}</span><span className="block truncate text-[10px] opacity-80">{trip.status === "COMPLETED" ? "実績 " : liveOverdue ? "超過中 " : ""}{formatTime(displayStart)}～{liveOverdue ? `現在 ${formatTime(displayEnd)}` : formatTime(displayEnd)}</span>
              </button>;
            })}
          </div>
        </div>;
      })}
    </div>
  </div></>;
}

function VehicleEquipmentBadges({ vehicle, compact = false }: { vehicle: Pick<Vehicle, "hasEtc" | "hasNavigation">; compact?: boolean }) {
  if (!vehicle.hasEtc && !vehicle.hasNavigation) return null;
  return <span className={cn("flex items-center gap-1", compact ? "mt-0.5 justify-center" : "mt-1.5")} aria-label={`装備：${[vehicle.hasEtc ? "ETC" : "", vehicle.hasNavigation ? "ナビ" : ""].filter(Boolean).join("、")}`}>
    {vehicle.hasEtc ? <span className={cn("rounded bg-sky-100 font-black text-sky-700", compact ? "px-1 text-[6px] leading-[9px] sm:text-[7px]" : "px-1.5 py-0.5 text-[10px]")}>ETC</span> : null}
    {vehicle.hasNavigation ? <span className={cn("rounded bg-violet-100 font-black text-violet-700", compact ? "px-1 text-[6px] leading-[9px] sm:text-[7px]" : "px-1.5 py-0.5 text-[10px]")}>ナビ</span> : null}
  </span>;
}

function ParkingMap({ data, changedVehicleIds, mutate, openStart, openReturn, openMove, actorName }: { data: DashboardData; changedVehicleIds: string[]; mutate: (body: object, success: string) => Promise<boolean>; openStart: (vehicle?: Vehicle) => void; openReturn: (spot: ParkingSpot) => void; openMove: (vehicle: Vehicle) => void; actorName: string }) {
  const [dragVehicle, setDragVehicle] = useState<Vehicle | null>(null);
  return <Card className="overflow-hidden">
    <div className="p-4 md:p-5">
      <div className="relative mx-auto aspect-[950/525] w-full max-w-[1180px] overflow-hidden rounded-xl border border-slate-200 bg-white">
        <img src="/parking-layout.svg" alt="" className="pointer-events-none absolute inset-0 size-full select-none" draggable={false} />
        {data.spots.map((spot) => <div key={spot.id} onDragOver={(e) => { if (dragVehicle && !spot.vehicle && canUseSpot(dragVehicle, spot)) e.preventDefault(); }} onDrop={() => { if (dragVehicle && !spot.vehicle && canUseSpot(dragVehicle, spot)) mutate({ action: "moveVehicle", vehicleId: dragVehicle.id, version: dragVehicle.version, spotId: spot.id, actorName }, `${formatSpotLabel(spot.code)}へ移動しました`); setDragVehicle(null); }} className={cn("absolute grid place-items-center rounded-[4px] border-2 transition", parkingSpotClass(spot), dragVehicle && !spot.vehicle && canUseSpot(dragVehicle, spot) && "border-dashed bg-emerald-100", dragVehicle && !spot.vehicle && !canUseSpot(dragVehicle, spot) && "cursor-not-allowed opacity-60", spot.vehicle && changedVehicleIds.includes(spot.vehicle.id) && "z-10 ring-4 ring-amber-300 animate-pulse")} style={{ left: `${spot.x}%`, top: `${spot.y}%`, width: `${spot.width}%`, height: `${spot.height}%` }}>
          <span className="absolute left-1 top-0.5 z-[1] text-[9px] font-black text-slate-500">{spot.code}{isSakuraSpot(spot) ? <small className="ml-0.5 hidden text-[7px] sm:inline">サクラ専用</small> : CUSTOMER_SPOT_CODES.has(spot.code) ? <small className="ml-0.5 hidden text-[7px] sm:inline">お客様用</small> : HOLDING_SPOT_CODES.has(spot.code) ? <small className="ml-0.5 text-[7px]">仮置き</small> : TEMPORARY_SPOT_CODES.has(spot.code) ? <small className="ml-0.5 hidden text-[7px] text-slate-400 sm:inline">一時</small> : null}</span>
          {spot.vehicle ? <div className="relative size-full"><button type="button" title={`${spot.vehicle.name}（${spot.vehicle.plateNumber}・${spot.vehicle.code}）${spot.vehicle.hasEtc ? "・ETC付" : ""}${spot.vehicle.hasNavigation ? "・ナビ付" : ""}を利用開始`} onClick={() => { if (spot.vehicle?.status === "AVAILABLE") openStart(spot.vehicle); }} className={cn("grid size-full place-content-center overflow-hidden text-center", spot.vehicle.status !== "AVAILABLE" && "cursor-not-allowed opacity-60")}><CarFront className="mx-auto size-4 sm:size-5" style={{ color: spot.vehicle.color }} /><b className="mt-0.5 block max-w-full truncate px-1 text-[8px] leading-tight sm:text-[10px]">{spot.vehicle.name}</b><small className="mt-0.5 block whitespace-nowrap text-[7px] font-bold leading-none text-slate-500 sm:text-[8px]">{formatPlateShort(spot.vehicle.plateNumber)} ・ {spot.vehicle.code}</small><VehicleEquipmentBadges vehicle={spot.vehicle} compact /></button><button type="button" title="駐車位置を移動" aria-label={`${spot.vehicle.name}の駐車位置を移動`} onClick={() => openMove(spot.vehicle!)} draggable onDragStart={() => setDragVehicle(spot.vehicle)} onDragEnd={() => setDragVehicle(null)} className="absolute right-1 top-1 grid size-7 cursor-grab place-items-center rounded-lg border border-slate-200 bg-white/95 text-slate-600 shadow-md transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 active:cursor-grabbing"><GripVertical className="size-4" /></button></div> : <button type="button" title={`${formatSpotLabel(spot.code)}へ返却`} onClick={() => { if (!dragVehicle) openReturn(spot); }} className="grid size-full place-content-center text-center text-[9px] font-bold text-slate-500 transition hover:bg-slate-100/70 sm:text-[10px]"><MapPin className="mx-auto mb-0.5 size-3" />{HOLDING_SPOT_CODES.has(spot.code) ? "仮置き" : TEMPORARY_SPOT_CODES.has(spot.code) ? "一時" : isSakuraSpot(spot) ? "サクラ" : "空き"}<span className="hidden sm:block">{HOLDING_SPOT_CODES.has(spot.code) ? "実在なし" : TEMPORARY_SPOT_CODES.has(spot.code) ? "駐車可" : isSakuraSpot(spot) ? "専用" : "返却"}</span></button>}
        </div>)}
      </div>
    </div>
  </Card>;
}

function DialogShell({ title, subtitle, onClose, children, wide = false, busy = false }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode; wide?: boolean; busy?: boolean }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  useEffect(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = dialog?.querySelector<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])");
    focusable?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); if (!busyRef.current) onCloseRef.current(); return; }
      if (event.key !== "Tab" || !dialog) return;
      const items = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])")];
      if (items.length === 0) return;
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); returnFocus.current?.focus(); };
  }, []);
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-3 backdrop-blur-sm sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} className={cn("max-h-[94vh] w-full overflow-y-auto rounded-2xl bg-white shadow-2xl sm:rounded-3xl", wide ? "max-w-3xl" : "max-w-lg")}><div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-100 bg-white p-4 sm:p-5"><div><div className="flex flex-wrap items-center gap-2"><h2 id={titleId} className="text-lg font-black">{title}</h2>{busy ? <span role="status" className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-bold text-blue-700"><LoaderCircle className="size-3 animate-spin" />処理中</span> : null}</div><p className="mt-1 text-xs text-slate-500">{subtitle}</p></div><button aria-label={busy ? "処理中は閉じられません" : "閉じる"} disabled={busy} onClick={onClose} className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 transition disabled:cursor-not-allowed disabled:opacity-40"><X className="size-4" /></button></div><div className="p-4 sm:p-5">{children}</div></div></div>;
}

function OperationProgress({ labels, current, className }: { labels: [string, string, string]; current: 1 | 2 | 3; className?: string }) {
  return <ol aria-label="操作の進行状況" className={cn("grid grid-cols-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-50", className)}>{labels.map((label, index) => {
    const step = (index + 1) as 1 | 2 | 3;
    const complete = step < current;
    const active = step === current;
    return <li key={label} aria-current={active ? "step" : undefined} className={cn("flex min-h-10 items-center justify-center gap-1.5 border-r border-slate-200 px-2 text-center text-[11px] font-bold last:border-r-0", active ? "bg-blue-600 text-white" : complete ? "bg-emerald-50 text-emerald-700" : "text-slate-400")}><span className={cn("grid size-5 shrink-0 place-items-center rounded-full text-[10px]", active ? "bg-white text-blue-700" : complete ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-500")}>{complete ? <Check className="size-3" /> : step}</span><span>{label}</span></li>;
  })}</ol>;
}
const field = "min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50";
const compactField = "min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-50";
const NFC_SCAN_TIMEOUT_MS = 15_000;
function useNfcScanTimeout(active: boolean, onTimeout: () => void) {
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => onTimeoutRef.current(), NFC_SCAN_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [active]);
}
function StartDialog({ employees, vehicles, trips, initialEmployee, initialVehicleId, submitting, onClose, onSubmit }: { employees: Employee[]; vehicles: Vehicle[]; trips: Trip[]; initialEmployee: Employee | null; initialVehicleId: string; submitting: boolean; onClose: () => void; onSubmit: (v: { employeeId: string; employeeName: string; vehicleId: string; minutes: number; plannedStart: string | null }) => void }) {
  const [employeeId, setEmployeeId] = useState(initialEmployee?.id ?? "");
  const [nfcUid, setNfcUid] = useState(initialEmployee?.nfcUid ?? "");
  const [nfcError, setNfcError] = useState("");
  const [employeeScanEnabled, setEmployeeScanEnabled] = useState(!initialEmployee);
  const [employeeScanTimedOut, setEmployeeScanTimedOut] = useState(false);
  const vehicleId = initialVehicleId;
  const [totalMinutes, setTotalMinutes] = useState(60);
  const [startMode, setStartMode] = useState<"now" | "scheduled">("now");
  const [scheduleKind, setScheduleKind] = useState<"timed" | "allDay" | "multiDay">("timed");
  const [scheduledStart, setScheduledStart] = useState(() => nextQuarterHour());
  const [multiDayStart, setMultiDayStart] = useState(() => nextQuarterHour());
  const [multiDayEnd, setMultiDayEnd] = useState(() => new Date(nextQuarterHour().getTime() + 24 * 60 * 60_000));
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 30_000); return () => window.clearInterval(timer); }, []);
  const orderedEmployees = [...employees].sort((left, right) => left.code.localeCompare(right.code, "ja", { numeric: true }));
  const selectedEmployee = employees.find((person) => person.id === employeeId);
  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === vehicleId);
  const scheduledEnd = scheduleKind === "allDay" ? new Date(new Date(scheduledStart).setHours(22, 0, 0, 0)) : scheduleKind === "multiDay" ? multiDayEnd : new Date(scheduledStart.getTime() + totalMinutes * 60_000);
  const effectiveStart = startMode === "now" ? now : scheduleKind === "multiDay" ? multiDayStart : scheduledStart;
  const plannedEnd = startMode === "now" ? new Date(now.getTime() + totalMinutes * 60_000) : scheduledEnd;
  const submissionMinutes = startMode === "now" ? totalMinutes : Math.round((plannedEnd.getTime() - effectiveStart.getTime()) / 60_000);
  const durationLabel = totalMinutes < 60 ? `${totalMinutes}分` : `${Math.floor(totalMinutes / 60)}時間${totalMinutes % 60 ? `${totalMinutes % 60}分` : ""}`;
  const changeDuration = (amount: number) => setTotalMinutes((current) => Math.max(15, Math.min(10_080, current + amount)));
  const changeScheduledStart = (amount: number) => setScheduledStart((current) => {
    const minimum = nextQuarterHour();
    const candidate = new Date(current.getTime() + amount * 60_000);
    return candidate < minimum ? minimum : candidate;
  });
  const setScheduledDay = (offset: 0 | 1) => setScheduledStart((current) => {
    const target = new Date();
    target.setDate(target.getDate() + offset);
    target.setHours(current.getHours(), current.getMinutes(), 0, 0);
    const minimum = nextQuarterHour();
    return target < minimum ? minimum : target;
  });
  const scheduledDay = scheduledStart.toDateString() === new Date().toDateString() ? 0 : 1;
  const scheduledValid = startMode === "now" || (effectiveStart > now && plannedEnd > effectiveStart && submissionMinutes >= 15 && submissionMinutes <= 10_080);
  const activeReservation = selectedEmployee ? trips.filter((trip) => trip.status === "RESERVED" && trip.vehicleId === vehicleId && trip.employeeId === selectedEmployee.id && new Date(trip.plannedStart).getTime() <= now.getTime() && new Date(trip.plannedEnd).getTime() > now.getTime()).sort((left, right) => new Date(left.plannedStart).getTime() - new Date(right.plannedStart).getTime())[0] : undefined;
  const activeReservationMinutes = activeReservation ? Math.max(15, Math.ceil((new Date(activeReservation.plannedEnd).getTime() - now.getTime()) / 60_000)) : submissionMinutes;
  const identifyEmployee = (uid: string) => {
    const normalized = normalizeNfcUid(uid);
    const person = employees.find((item) => sameNfcUid(item.nfcUid, normalized));
    if (!person) { setEmployeeId(""); setNfcError("登録されていない社員タグです"); return; }
    setEmployeeId(person.id); setNfcUid(person.nfcUid); setNfcError(""); setEmployeeScanEnabled(false); setEmployeeScanTimedOut(false);
  };
  const bridgeStatus = useNfcBridge(!selectedEmployee && employeeScanEnabled, identifyEmployee);
  useNfcScanTimeout(!selectedEmployee && employeeScanEnabled, () => {
    setEmployeeScanEnabled(false);
    setEmployeeScanTimedOut(true);
  });
  return <DialogShell wide busy={submitting} title={activeReservation ? "予約した車両を利用開始" : "利用開始を登録"} subtitle={activeReservation ? "予約内容を確認し、実際の利用開始を登録してください" : "社員証をかざし、利用開始と返却予定を確認してください"} onClose={onClose}><form className="start-dialog grid gap-5 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (selectedEmployee && (activeReservation || scheduledValid)) onSubmit({ employeeId, employeeName: selectedEmployee.name, vehicleId, minutes: activeReservationMinutes, plannedStart: activeReservation ? null : startMode === "scheduled" ? effectiveStart.toISOString() : null }); }}>
    <OperationProgress labels={["車両確認", "利用者認証", "内容確認"]} current={!selectedVehicle ? 1 : !selectedEmployee ? 2 : 3} className="sm:col-span-2" />
    <div className="flex h-full flex-col gap-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 md:min-h-[390px]"><div><p className="mb-2 text-xs font-bold text-slate-600">利用者（社員NFC）</p>{selectedEmployee ? <div role="status" className="flex min-h-24 items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4"><span className="grid size-12 shrink-0 place-items-center rounded-full bg-emerald-600 text-white"><Check className="size-6" /></span><div className="min-w-0 flex-1"><p className="text-base font-black">{selectedEmployee.name}</p><p className="text-xs text-emerald-700">社員番号 {selectedEmployee.code} ・ {selectedEmployee.department}</p><p className="mt-1 text-[11px] font-bold text-emerald-700">社員証を認識しました</p></div><button type="button" onClick={() => { setEmployeeId(""); setNfcUid(""); setEmployeeScanEnabled(true); setEmployeeScanTimedOut(false); }} className="min-h-12 shrink-0 whitespace-nowrap rounded-xl px-3 text-xs font-bold text-emerald-700 hover:bg-emerald-100">選び直す</button></div> : <div className={cn("rounded-xl border p-4", employeeScanTimedOut ? "border-amber-200 bg-amber-50" : "border-blue-200 bg-blue-50")}><div className={cn("flex min-h-24 items-center gap-3", employeeScanTimedOut ? "text-amber-800" : "text-blue-700")}><span className="grid size-14 shrink-0 place-items-center rounded-full bg-white"><Nfc className={cn("size-8", employeeScanEnabled && "animate-pulse")} /></span><div><p className="text-base font-black">{employeeScanTimedOut ? "社員証を読み取れませんでした" : "社員証をかざしてください"}</p><p role="status" aria-live="polite" className={cn("mt-1 text-xs", employeeScanTimedOut ? "font-bold text-amber-700" : bridgeStatus === "ready" ? "font-bold text-emerald-700" : "text-blue-600")}>{employeeScanTimedOut ? "15秒以内に読み取れませんでした。再試行または手動選択ができます。" : nfcBridgeStatusText(bridgeStatus)}</p></div></div>{nfcError ? <p role="alert" className="mt-3 rounded-xl bg-white p-3 text-xs font-bold text-rose-600">{nfcError}</p> : null}{employeeScanTimedOut ? <button type="button" onClick={() => { setEmployeeScanEnabled(true); setEmployeeScanTimedOut(false); setNfcError(""); }} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-amber-600 px-3 text-xs font-bold text-white hover:bg-amber-700"><Nfc className="size-4" />NFC読取を再試行</button> : null}<details className={cn("mt-3 border-t pt-3", employeeScanTimedOut ? "border-amber-200" : "border-blue-200")}><summary className="flex min-h-12 cursor-pointer list-none items-center justify-center rounded-xl text-xs font-bold text-slate-600 hover:bg-white/70">NFCを使わず社員を選択</summary><div className="mt-3 space-y-3"><select aria-label="社員を選択" className={field} value="" onChange={(event) => { const person = employees.find((item) => item.id === event.target.value); if (person) { setEmployeeId(person.id); setNfcUid(person.nfcUid); setNfcError(""); setEmployeeScanEnabled(false); setEmployeeScanTimedOut(false); } }}><option value="">社員番号から選択してください</option>{orderedEmployees.map((person) => <option key={person.id} value={person.id}>{person.code}　{person.name}（{person.department}）</option>)}</select><div className="flex gap-2"><input aria-label="NFC UIDを手入力" className={field} value={nfcUid} onChange={(event) => setNfcUid(event.target.value)} onBlur={() => setNfcUid(normalizeNfcUid(nfcUid))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); identifyEmployee(nfcUid); } }} placeholder="NFC UIDを手入力" /><Button type="button" className="min-h-12 shrink-0 whitespace-nowrap px-4" onClick={() => identifyEmployee(nfcUid)}>認識</Button></div></div></details></div>}</div><div className="mt-auto"><p className="mb-2 text-xs font-bold text-slate-600">車両（変更不可）</p>{selectedVehicle ? <div className="flex min-h-20 items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4"><span className="grid size-12 shrink-0 place-items-center rounded-xl bg-white"><CarFront className="size-6" style={{ color: selectedVehicle.color }} /></span><div className="min-w-0"><p className="truncate text-base font-black text-slate-900">{selectedVehicle.name}</p><p className="truncate text-xs text-blue-700">{selectedVehicle.plateNumber}</p><VehicleEquipmentBadges vehicle={selectedVehicle} /></div></div> : <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-700">車両を確認できません。画面を閉じて選び直してください。</p>}<p className="mt-1.5 text-[10px] text-slate-400">変更する場合は画面を閉じ、利用する車両を選び直してください。</p></div></div>
    {activeReservation ? <div className="flex flex-col gap-4 rounded-2xl border border-violet-200 bg-violet-50/70 p-4"><div><span className="inline-flex rounded-full bg-violet-600 px-3 py-1 text-xs font-black text-white">予約</span><h3 className="mt-3 text-lg font-black text-violet-950">予約内容を確認</h3><p className="mt-1 text-xs text-violet-700">時間の再入力は不要です。現在時刻を実際の開始として記録します。</p></div><div className="rounded-xl border border-violet-200 bg-white p-4"><p className="text-xs font-bold text-violet-600">利用予定</p><p className="mt-1 text-xl font-black text-slate-900">{formatDateTime(activeReservation.plannedStart)} ～ {formatDateTime(activeReservation.plannedEnd)}</p><div className="mt-3 grid grid-cols-2 gap-3 border-t border-violet-100 pt-3 text-xs"><div><p className="text-slate-400">利用者</p><p className="mt-1 font-black">{activeReservation.employee.name}</p></div><div><p className="text-slate-400">車両</p><p className="mt-1 font-black">{activeReservation.vehicle.name}</p></div></div></div><div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs font-bold text-blue-800">NFC認証済みです。利用開始後は車両が「利用中」になります。</div><Button type="submit" className="mt-auto min-h-14 w-full text-base" disabled={submitting || !selectedEmployee || !selectedVehicle}>{submitting ? <LoaderCircle className="size-5 animate-spin" /> : <CarFront className="size-5" />}{submitting ? "利用開始中…" : "予約した車両を利用開始"}</Button></div> : <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
      <div><p className="mb-2 text-xs font-bold text-slate-600">利用開始</p><div className="grid grid-cols-2 rounded-xl bg-slate-200/70 p-1"><button type="button" aria-pressed={startMode === "now"} onClick={() => setStartMode("now")} className={cn("min-h-11 rounded-lg text-sm font-black transition", startMode === "now" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500")}>今すぐ</button><button type="button" aria-pressed={startMode === "scheduled"} onClick={() => { setStartMode("scheduled"); setScheduledStart((current) => current < nextQuarterHour() ? nextQuarterHour() : current); }} className={cn("min-h-11 rounded-lg text-sm font-black transition", startMode === "scheduled" ? "bg-white text-violet-700 shadow-sm" : "text-slate-500")}>時刻指定</button></div></div>
      {startMode === "scheduled" ? <div className="space-y-2 rounded-xl border border-violet-200 bg-violet-50 p-3"><div className="grid grid-cols-3 gap-1 rounded-lg bg-violet-100 p-1">{([{ value: "timed", label: "時間指定" }, { value: "allDay", label: "終日" }, { value: "multiDay", label: "複数日" }] as const).map((kind) => <button type="button" key={kind.value} aria-pressed={scheduleKind === kind.value} onClick={() => { setScheduleKind(kind.value); if (kind.value === "allDay") setScheduledStart(nextAllDayStart()); if (kind.value === "multiDay") { const start = nextQuarterHour(); setMultiDayStart(start); setMultiDayEnd(new Date(start.getTime() + 24 * 60 * 60_000)); } }} className={cn("min-h-10 rounded-md px-1 text-[11px] font-black", scheduleKind === kind.value ? "bg-white text-violet-700 shadow-sm" : "text-violet-500")}>{kind.label}</button>)}</div>
        {scheduleKind !== "multiDay" ? <div className="grid grid-cols-2 gap-2"><button type="button" aria-pressed={scheduledDay === 0} onClick={() => setScheduledDay(0)} disabled={scheduleKind === "allDay" && nextAllDayStart().toDateString() !== new Date().toDateString()} className={cn("min-h-10 rounded-lg text-xs font-black disabled:cursor-not-allowed disabled:opacity-35", scheduledDay === 0 ? "bg-violet-600 text-white" : "bg-white text-violet-700")}>今日</button><button type="button" aria-pressed={scheduledDay === 1} onClick={() => setScheduledDay(1)} className={cn("min-h-10 rounded-lg text-xs font-black", scheduledDay === 1 ? "bg-violet-600 text-white" : "bg-white text-violet-700")}>明日</button></div> : null}
        {scheduleKind === "timed" ? <div className="grid grid-cols-[1fr_1.2fr_1fr] items-center gap-2"><button type="button" aria-label="開始を15分早める" onClick={() => changeScheduledStart(-15)} disabled={scheduledStart.getTime() <= nextQuarterHour().getTime()} className="min-h-11 rounded-lg bg-white text-xs font-black text-violet-700 disabled:opacity-35">−15分</button><div className="text-center"><p className="text-[10px] font-bold text-violet-500">開始予定</p><p aria-live="polite" className="text-xl font-black text-violet-900">{formatTime(scheduledStart)}</p></div><button type="button" aria-label="開始を15分遅らせる" onClick={() => changeScheduledStart(15)} className="min-h-11 rounded-lg bg-white text-xs font-black text-violet-700">＋15分</button></div> : null}
        {scheduleKind === "allDay" ? <div className="rounded-lg bg-white p-3 text-center"><p className="text-[10px] font-bold text-violet-500">終日予約</p><p className="text-lg font-black text-violet-900">6:00 ～ 22:00</p></div> : null}
        {scheduleKind === "multiDay" ? <div className="grid gap-2"><label className="text-[10px] font-bold text-violet-700">開始日時<input type="datetime-local" step={900} min={toLocalDateTimeInput(nextQuarterHour())} className="mt-1 min-h-11 w-full rounded-lg border border-violet-200 bg-white px-2 text-sm font-bold" value={toLocalDateTimeInput(multiDayStart)} onChange={(event) => { const value = new Date(event.target.value); if (!Number.isNaN(value.getTime())) { setMultiDayStart(value); if (multiDayEnd <= value) setMultiDayEnd(new Date(value.getTime() + 24 * 60 * 60_000)); } }} /></label><label className="text-[10px] font-bold text-violet-700">終了日時<input type="datetime-local" step={900} min={toLocalDateTimeInput(new Date(multiDayStart.getTime() + 15 * 60_000))} max={toLocalDateTimeInput(new Date(multiDayStart.getTime() + 7 * 24 * 60 * 60_000))} className="mt-1 min-h-11 w-full rounded-lg border border-violet-200 bg-white px-2 text-sm font-bold" value={toLocalDateTimeInput(multiDayEnd)} onChange={(event) => { const value = new Date(event.target.value); if (!Number.isNaN(value.getTime())) setMultiDayEnd(value); }} /></label><p className="text-center text-[10px] text-violet-600">連続した期間・最大7日間</p></div> : null}
      </div> : null}
      {startMode === "now" || scheduleKind === "timed" ? <div><p className="mb-2 text-xs font-bold text-slate-600">利用予定時間</p><div className="grid grid-cols-4 gap-2">{[{ label: "30分", value: 30 }, { label: "1時間", value: 60 }, { label: "3時間", value: 180 }, { label: "5時間", value: 300 }].map((preset) => <button type="button" key={preset.value} aria-pressed={totalMinutes === preset.value} onClick={() => setTotalMinutes(preset.value)} className={cn("min-h-11 rounded-xl border px-1 text-sm font-black transition", totalMinutes === preset.value ? "border-blue-600 bg-blue-600 text-white shadow-sm" : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50")}>{preset.label}</button>)}</div><div className="mt-2 grid grid-cols-[1fr_1.4fr_1fr] items-center gap-2"><button type="button" aria-label="15分短くする" onClick={() => changeDuration(-15)} disabled={totalMinutes <= 15} className="min-h-11 rounded-xl border border-slate-200 bg-white text-xs font-black text-slate-700 hover:bg-slate-100 disabled:opacity-35">−15分</button><div className="text-center"><p className="text-[10px] font-bold text-slate-400">選択中</p><p aria-live="polite" className="text-base font-black text-slate-900">{durationLabel}</p></div><button type="button" aria-label="15分長くする" onClick={() => changeDuration(15)} className="min-h-11 rounded-xl border border-slate-200 bg-white text-xs font-black text-slate-700 hover:bg-slate-100">＋15分</button></div></div> : null}
      <div className={cn("rounded-xl border-2 p-3 text-center", startMode === "scheduled" ? "border-violet-200 bg-violet-50" : "border-emerald-200 bg-emerald-50")}><p className={cn("text-[10px] font-bold", startMode === "scheduled" ? "text-violet-700" : "text-emerald-700")}>{startMode === "scheduled" ? "利用予定" : "返却予定"}</p><p className={cn("mt-0.5 text-xl font-black tracking-tight", startMode === "scheduled" ? "text-violet-900" : "text-emerald-800")}>{formatTime(effectiveStart)} ～ {formatTime(plannedEnd)}</p><p className={cn("text-[10px]", startMode === "scheduled" ? "text-violet-700" : "text-emerald-700")}>{formatDateTime(effectiveStart)} ～ {formatDateTime(plannedEnd)}</p>{startMode === "scheduled" ? <p className="mt-1 text-[10px] font-bold text-violet-700">開始から{RESERVATION_GRACE_MINUTES}分以内に利用開始されない場合は自動取消</p> : null}</div>
      <Button type="submit" className={cn("min-h-14 w-full text-base", startMode === "scheduled" && "bg-violet-600 hover:bg-violet-700")} disabled={submitting || !selectedEmployee || !selectedVehicle || !scheduledValid}>{submitting ? <LoaderCircle className="size-5 animate-spin" /> : startMode === "scheduled" ? <Clock3 className="size-5" /> : <CarFront className="size-5" />}{submitting ? "登録しています…" : startMode === "scheduled" ? "この内容で予約" : "この内容で利用開始"}</Button>
    </div>}
  </form></DialogShell>;
}
function EditTripDialog({ trip, submitting, onClose, onAdjust, onSetEnd, onCancel }: { trip: Trip; submitting: boolean; onClose: () => void; onAdjust: (minutes: -60 | -30 | -15 | 15 | 30 | 60 | 180 | 300) => void; onSetEnd: (plannedEnd: string) => void; onCancel: () => void }) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [customEnd, setCustomEnd] = useState(() => toLocalDateTimeInput(new Date(trip.plannedEnd)));
  const rawMinimumEnd = Math.max(new Date(trip.plannedStart).getTime() + 15 * 60_000, trip.status === "IN_USE" ? Date.now() : 0);
  const minimumEnd = new Date(Math.ceil(rawMinimumEnd / (15 * 60_000)) * 15 * 60_000);
  const maximumEnd = new Date(new Date(trip.plannedStart).getTime() + 7 * 24 * 60 * 60_000);
  const selectedEnd = new Date(customEnd);
  const customEndValid = Number.isFinite(selectedEnd.getTime()) && selectedEnd >= minimumEnd && selectedEnd <= maximumEnd && selectedEnd.getTime() !== new Date(trip.plannedEnd).getTime();
  const quickLabel = (minutes: number) => minutes >= 60 ? `${minutes / 60}時間` : `${minutes}分`;
  const canAdjust = (minutes: number) => {
    const proposedEnd = new Date(trip.plannedEnd).getTime() + minutes * 60_000;
    return proposedEnd >= rawMinimumEnd && proposedEnd <= maximumEnd.getTime();
  };
  return <DialogShell busy={submitting} title="登録情報を修正" subtitle={`${trip.vehicle.name} ・ ${trip.employee.name}`} onClose={onClose}><div className="space-y-5">
    <div className="rounded-2xl bg-slate-50 p-4"><div className="flex items-center justify-between gap-3"><span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-bold", trip.status === "IN_USE" ? "bg-blue-100 text-blue-700" : "bg-violet-100 text-violet-700")}>{trip.status === "IN_USE" ? "利用中" : "予約"}</span><span className="text-right text-sm font-black">{formatDateTime(trip.plannedStart)}–{formatDateTime(trip.plannedEnd)}</span></div></div>
    <div><p className="mb-2 text-xs font-bold text-slate-600">終了時間をすばやく変更</p><div className="grid grid-cols-3 gap-2">{([-15, -30, -60] as const).map((minutes) => <button type="button" key={minutes} disabled={submitting || !canAdjust(minutes)} onClick={() => onAdjust(minutes)} className="min-h-12 rounded-xl border border-amber-200 bg-amber-50 text-sm font-black text-amber-700 transition hover:border-amber-500 disabled:cursor-not-allowed disabled:opacity-35">−{quickLabel(Math.abs(minutes))}</button>)}</div><div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">{([15, 30, 60, 180, 300] as const).map((minutes) => <button type="button" key={minutes} disabled={submitting || !canAdjust(minutes)} onClick={() => onAdjust(minutes)} className="min-h-12 rounded-xl border border-blue-200 bg-blue-50 px-1 text-sm font-black text-blue-700 transition hover:border-blue-500 disabled:opacity-40">＋{quickLabel(minutes)}</button>)}</div></div>
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><label htmlFor="custom-trip-end" className="text-xs font-bold text-slate-700">終了日時を指定</label><div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]"><input id="custom-trip-end" type="datetime-local" step={900} min={toLocalDateTimeInput(minimumEnd)} max={toLocalDateTimeInput(maximumEnd)} value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} className="min-h-12 min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base font-bold text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /><Button type="button" disabled={submitting || !customEndValid} onClick={() => onSetEnd(selectedEnd.toISOString())} className="min-h-12 whitespace-nowrap">この日時に変更</Button></div><p className="mt-2 text-[11px] leading-relaxed text-slate-500">15分単位・開始から7日以内で指定できます。日をまたぐ利用にも対応しています。</p></div>
    <p className="text-[11px] text-slate-400">15分未満への短縮、現在時刻以前への短縮、次の予約と重なる延長はできません。</p>
    {trip.status === "RESERVED" ? <div className="border-t border-slate-100 pt-4"><p className="mb-3 text-center text-[11px] font-bold text-amber-700">開始から{RESERVATION_GRACE_MINUTES}分以内に利用開始されない場合は自動取消されます</p>{confirmCancel ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4"><p className="text-sm font-bold text-rose-800">この予約を取り消しますか？</p><div className="mt-3 grid grid-cols-2 gap-2"><Button variant="ghost" onClick={() => setConfirmCancel(false)}>戻る</Button><Button variant="danger" onClick={onCancel}>予約を取り消す</Button></div></div> : <Button variant="ghost" className="w-full border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => setConfirmCancel(true)}>予約の取り消し</Button>}</div> : null}
  </div></DialogShell>;
}
function ParkingReturnDialog({ spot, trips: allTrips, vehicles, submitting, onClose, onSubmit }: { spot: ParkingSpot; trips: Trip[]; vehicles: Vehicle[]; submitting: boolean; onClose: () => void; onSubmit: (trip: Trip) => void }) {
  const [method, setMethod] = useState<"manual" | "nfc">("nfc");
  const [tripId, setTripId] = useState("");
  const [nfcError, setNfcError] = useState("");
  const [fallbackNotice, setFallbackNotice] = useState("");
  const trips = isSakuraSpot(spot) ? allTrips.filter((trip) => trip.vehicle.code === SAKURA_VEHICLE_CODE) : allTrips;
  const selected = trips.find((trip) => trip.id === tripId);
  const bridgeStatus = useNfcBridge(method === "nfc", (uid) => {
    const vehicle = vehicles.find((item) => sameNfcUid(item.nfcUid, uid));
    if (!vehicle) { setTripId(""); setNfcError("登録されていない車両タグです"); return; }
    const activeTrip = allTrips.find((item) => item.vehicleId === vehicle.id);
    if (!activeTrip) { setTripId(""); setNfcError(`${vehicle.name}は現在利用中ではありません`); return; }
    const trip = trips.find((item) => item.id === activeTrip.id);
    if (!trip) { setTripId(""); setNfcError(`${vehicle.name}は${formatSpotLabel(spot.code)}へ返却できません`); return; }
    setTripId(trip.id); setNfcError("");
  });
  useEffect(() => {
    if (method !== "nfc" || (bridgeStatus !== "offline" && bridgeStatus !== "no-reader")) return;
    setFallbackNotice(bridgeStatus === "offline" ? "NFC連携ソフトに接続できないため、手動選択へ切り替えました。" : "NFCリーダーが接続されていないため、手動選択へ切り替えました。");
    setMethod("manual");
  }, [bridgeStatus, method]);
  useNfcScanTimeout(method === "nfc" && !selected, () => {
    setFallbackNotice("15秒以内に車両タグを読み取れなかったため、手動選択へ切り替えました。");
    setMethod("manual");
  });
  const switchMethod = (next: "manual" | "nfc") => { setMethod(next); setFallbackNotice(""); setNfcError(""); setTripId(""); };
  return <DialogShell busy={submitting} title={`${formatSpotLabel(spot.code)} へ返却`} subtitle={CUSTOMER_SPOT_CODES.has(spot.code) ? "お客様用区画ですが、社用車も返却できます" : HOLDING_SPOT_CODES.has(spot.code) ? "実在する駐車区画ではありません。駐車場所を確定できない場合だけ使用してください" : TEMPORARY_SPOT_CODES.has(spot.code) ? "通常区画ではありませんが、一時的な返却先として利用できます" : "車両タグを読み取り、返却内容を確認してください"} onClose={onClose}><div className="space-y-4">
    <OperationProgress labels={["返却先", "車両読取", "内容確定"]} current={selected ? 3 : 2} />
    {trips.length === 0 ? <Empty label="現在利用中の車両はありません" /> : method === "manual" ? <div className="space-y-3">{fallbackNotice ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">{fallbackNotice}</p> : null}<Label text="返却する車両"><select className={field} value={tripId} onChange={(event) => setTripId(event.target.value)}><option value="">車両を選択してください</option>{trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.vehicle.name}　{trip.vehicle.plateNumber}（{trip.employee.name}）</option>)}</select></Label><button type="button" onClick={() => switchMethod("nfc")} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-700 hover:bg-blue-100"><Nfc className="size-4" />NFC読取を再試行</button></div> : <div className={cn("rounded-2xl border p-4 transition", selected ? "border-emerald-300 bg-emerald-50" : "border-blue-200 bg-blue-50")}><div className="text-center"><span className={cn("mx-auto grid size-14 place-items-center rounded-full", selected ? "bg-emerald-600 text-white" : "bg-white text-blue-600")} >{selected ? <Check className="size-7" /> : <Nfc className="size-8 animate-pulse" />}</span><p className={cn("mt-3 text-sm font-black", selected ? "text-emerald-800" : "text-blue-800")}>{selected ? "車両を読み取りました" : "車両のNFCタグをかざしてください"}</p><p className={cn("text-[11px]", bridgeStatus === "ready" ? "font-bold text-emerald-700" : "text-blue-500")}>{nfcBridgeStatusText(bridgeStatus)}</p>{nfcError ? <p role="alert" className="mt-3 rounded-xl bg-white p-3 text-xs font-bold text-rose-600">{nfcError}</p> : null}</div>{process.env.NODE_ENV === "development" && !selected ? <div className="mt-4 grid gap-2 sm:grid-cols-2">{trips.map((trip) => <button type="button" key={trip.id} onClick={() => { setTripId(trip.id); setNfcError(""); }} className="rounded-xl border border-blue-100 bg-white p-3 text-left text-xs transition hover:border-blue-300"><b className="block">{trip.vehicle.nfcUid}</b><span className="text-slate-500">{trip.vehicle.name} ・ {trip.employee.name}</span></button>)}</div> : null}{!selected ? <button type="button" onClick={() => switchMethod("manual")} className="mt-4 min-h-9 w-full text-xs font-bold text-slate-500 underline decoration-slate-300 underline-offset-4">NFCを使わず手動で選択</button> : null}</div>}
    {selected ? <div className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm"><div className="flex items-start gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700"><CarFront className="size-6" /></span><div className="min-w-0 flex-1"><p className="text-[11px] font-bold text-emerald-700">返却内容を確認</p><p className="truncate text-base font-black">{selected.vehicle.name} <span className="text-slate-400">・ {formatPlateShort(selected.vehicle.plateNumber)}</span></p><p className="mt-1 text-xs text-slate-600">返却先：<b>{formatSpotLabel(spot.code)}</b>　利用者：{selected.employee.name}</p></div><button type="button" onClick={() => setTripId("")} className="shrink-0 text-xs font-bold text-slate-500">選び直す</button></div></div> : null}
    <Button className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={!selected || submitting} onClick={() => selected && onSubmit(selected)}>{submitting ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}{submitting ? "返却登録中…" : "返却を完了して利用可能にする"}</Button>
    <p className="text-center text-[11px] text-slate-400">確認ボタンを押すまで返却は確定しません。</p>
  </div></DialogShell>;
}
function EndDialog({ trip, spots, submitting, onClose, onSubmit }: { trip: Trip; spots: ParkingSpot[]; submitting: boolean; onClose: () => void; onSubmit: (spotId: string) => void }) {
  const free = spots.filter((spot) => !spot.vehicle && canUseSpot(trip.vehicle, spot)); const [spotId, setSpotId] = useState("");
  const selected = free.find((spot) => spot.id === spotId);
  return <DialogShell busy={submitting} title="返却・駐車位置を登録" subtitle={`${trip.vehicle.name} の返却先を選択してください（22・23は実在しない仮置き）`} onClose={onClose}><div className="space-y-4"><OperationProgress labels={["車両確認", "返却先", "内容確定"]} current={selected ? 3 : 2} /><div className="grid grid-cols-3 gap-2">{free.map((spot) => <button key={spot.id} onClick={() => setSpotId(spot.id)} className={cn("min-h-14 rounded-xl border text-sm font-black", spotId === spot.id ? "border-emerald-500 bg-emerald-50 text-emerald-700 ring-2 ring-emerald-200" : HOLDING_SPOT_CODES.has(spot.code) ? "border-dotted border-zinc-400 bg-zinc-100 text-zinc-700" : "border-slate-200")}>{formatSpotLabel(spot.code)}</button>)}</div>{selected ? <div className={cn("rounded-xl p-3 text-sm font-bold", HOLDING_SPOT_CODES.has(selected.code) ? "bg-zinc-200 text-zinc-800" : "bg-emerald-50 text-emerald-800")}>{trip.vehicle.name}を{formatSpotLabel(selected.code)}へ返却します</div> : <p className="text-center text-xs font-bold text-amber-700">返却した区画を選択してください</p>}<Button className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={!spotId || submitting} onClick={() => onSubmit(spotId)}>{submitting ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}{submitting ? "返却登録中…" : "返却を完了"}</Button></div></DialogShell>;
}

function MoveVehicleDialog({ vehicle, spots, submitting, onClose, onSubmit }: { vehicle: Vehicle; spots: ParkingSpot[]; submitting: boolean; onClose: () => void; onSubmit: (spotId: string) => void }) {
  const [spotId, setSpotId] = useState("");
  const free = spots.filter((spot) => !spot.vehicle && canUseSpot(vehicle, spot));
  return <DialogShell busy={submitting} title="駐車位置を変更" subtitle={`${vehicle.name} の移動先を選択してください（22・23は実在しない仮置き）`} onClose={onClose}><div className="space-y-4"><div className="grid grid-cols-3 gap-2">{free.map((spot) => <button type="button" key={spot.id} onClick={() => setSpotId(spot.id)} className={cn("min-h-14 rounded-xl border text-sm font-black", spotId === spot.id ? "border-blue-500 bg-blue-50 text-blue-700 ring-2 ring-blue-200" : HOLDING_SPOT_CODES.has(spot.code) ? "border-dotted border-zinc-400 bg-zinc-100 text-zinc-700" : "border-slate-200")}>{formatSpotLabel(spot.code)}</button>)}</div><Button className="w-full" disabled={!spotId || submitting} onClick={() => onSubmit(spotId)}>{submitting ? <LoaderCircle className="size-4 animate-spin" /> : <MapPin className="size-4" />}{submitting ? "移動中…" : "この区画へ移動"}</Button></div></DialogShell>;
}
function NfcDialog({ employees, vehicles, onEmployee, onVehicle, onClose }: { employees: Employee[]; vehicles: Vehicle[]; onEmployee: (e: Employee) => void; onVehicle: (v: Vehicle) => void; onClose: () => void }) {
  const development = process.env.NODE_ENV === "development";
  const [error, setError] = useState("");
  const [scanEnabled, setScanEnabled] = useState(true);
  const [scanTimedOut, setScanTimedOut] = useState(false);
  const bridgeStatus = useNfcBridge(scanEnabled, (uid) => {
    const person = employees.find((item) => sameNfcUid(item.nfcUid, uid));
    if (person) { setScanEnabled(false); setScanTimedOut(false); onEmployee(person); return; }
    const vehicle = vehicles.find((item) => sameNfcUid(item.nfcUid, uid));
    if (vehicle) { setScanEnabled(false); setScanTimedOut(false); onVehicle(vehicle); return; }
    setError("登録されていないNFCタグです");
  });
  useNfcScanTimeout(scanEnabled, () => {
    setScanEnabled(false);
    setScanTimedOut(true);
  });
  return <DialogShell title="NFCタグを読み取る" subtitle={development ? "専用連携ソフトからの読み取りを待機しています。開発用タグでも確認できます。" : "専用連携ソフトからの読み取りを待機しています。"} onClose={onClose}><div className="text-center"><div className={cn("mx-auto mb-5 grid size-24 place-items-center rounded-full", scanTimedOut ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-600")}><Nfc className={cn("size-12", scanEnabled && "animate-pulse")} /></div><p className="text-sm font-bold">{scanTimedOut ? "タグを読み取れませんでした" : "タグをリーダーにかざしてください"}</p><p role="status" aria-live="polite" className={cn("mb-4 mt-1 text-[11px]", scanTimedOut ? "font-bold text-amber-700" : bridgeStatus === "ready" ? "font-bold text-emerald-700" : "text-slate-500")}>{scanTimedOut ? "15秒以内に読み取れませんでした。再試行するか、画面を閉じて手動操作してください。" : nfcBridgeStatusText(bridgeStatus)}</p>{error ? <p role="alert" className="mb-4 rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-700">{error}</p> : null}{scanTimedOut ? <button type="button" onClick={() => { setScanEnabled(true); setScanTimedOut(false); setError(""); }} className="mb-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 text-sm font-bold text-white hover:bg-amber-700"><Nfc className="size-4" />NFC読取を再試行</button> : null}{development ? <div className="grid grid-cols-2 gap-3 text-left"><div><p className="mb-2 text-xs font-bold text-slate-400">社員タグ（開発用）</p>{employees.slice(0, 3).map((p) => <button key={p.id} onClick={() => onEmployee(p)} className="mb-2 w-full rounded-xl border border-slate-200 p-3 text-xs font-bold hover:bg-slate-50">{p.nfcUid}<small className="block font-normal text-slate-400">{p.name}</small></button>)}</div><div><p className="mb-2 text-xs font-bold text-slate-400">車両タグ（開発用）</p>{vehicles.slice(0, 3).map((v) => <button key={v.id} onClick={() => onVehicle(v)} className="mb-2 w-full rounded-xl border border-slate-200 p-3 text-xs font-bold hover:bg-slate-50">{v.nfcUid}<small className="block font-normal text-slate-400">{v.name}</small></button>)}</div></div> : null}</div></DialogShell>;
}
function Label({ text, children }: { text: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-600">{text}</span>{children}</label>; }
