"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarClock, CarFront, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock3, Fuel, GripVertical, LayoutGrid, List, LoaderCircle, LogOut, Map as MapIcon, MapPin, Move, Nfc, Pencil, Play, Plus, Printer, RefreshCw, Settings, UserRound, Utensils, Wrench, X } from "lucide-react";
import type { DashboardData, Employee, ParkingSpot, Trip, Vehicle, VehicleMaintenance } from "@/lib/types";
import { normalizeNfcUid } from "@/lib/nfc";
import { createOperationId } from "@/lib/operation-id";
import { resolveNfcUid } from "@/lib/resolve-nfc";
import { canUseSpot, formatSpotLabel, isDashedSpot, spotRoleTag } from "@/lib/parking-spots";
import { RESERVATION_GRACE_MINUTES } from "@/lib/reservations";
import { FUEL_LEVEL_LABELS, FUEL_LEVEL_MAX, formatFuelLevel, isLowFuel } from "@/lib/fuel-level";
import { nfcBridgeStatusText, useNfcBridge, useNfcBridgeHealth } from "@/lib/use-nfc-bridge";
import { useKioskIdle, useKioskUserTimeout } from "@/lib/use-kiosk-idle";
import { playNfcSound } from "@/lib/nfc-sound";
import { clearSavedEmployee, forgetPersistentEmployee, readSavedEmployee, saveEmployee } from "@/lib/employee-session";
import { isKioskDevice, useDeviceMode, useUserTimeoutMinutes } from "@/lib/device-mode";
import { formatMaintenanceTime, MAINTENANCE_KIND_SHORT_LABELS } from "@/lib/maintenance";
import { activeMaintenanceOf, MaintenanceDialog } from "./maintenance-dialog";
import { NfcBridgeHelp } from "./nfc-bridge-help";
import { SettingsPanelV2 } from "./settings-panel-v2";
import { SpotRoleSettings } from "./spot-role-settings";
import { DepartmentSettings } from "./department-settings";
import { DataBackupPanel } from "./data-backup-panel";
import { Button, Card, cn } from "./ui";
import { AppHeader, HeaderDeviceMode, HeaderSystemStatus, HeaderUserControl, Navigation, type HeaderSyncState } from "./app-header";

const MINUTES_PER_DAY = 24 * 60;
const DAY_VIEW_START_MINUTE = 6 * 60;
const DAY_VIEW_END_MINUTE = 22 * 60;
type Dialog = "start" | "end" | "parkingReturn" | "fuel" | "edit" | "nfc" | "user" | null;
type DashboardView = "parking" | "timeline" | "settingsEmployees" | "settingsDepartments" | "settingsVehicles" | "settingsSpots" | "settingsData";
type SyncState = HeaderSyncState;
type StartContext = { vehicleId: string; employeeId: string };
type UndoReturn = { tripId: string; vehicleId: string; vehicleName: string; expiresAt: number };
const jpTime = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false });
const jpTimeSeconds = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const jpDate = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "long", day: "numeric", weekday: "long" });
const jpShortDate = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", weekday: "short" });
const jpDateTime = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const formatTime = (value: string | Date) => jpTime.format(new Date(value));
const formatDateTime = (value: string | Date) => jpDateTime.format(new Date(value));
// 一覧の時刻。今日なら時刻だけ、明日なら「翌」を付け、それ以降は日付も出す。
const formatShortTime = (value: string | Date, now: Date) => { const date = new Date(value); const days = Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000); return days === 0 ? formatTime(date) : days === 1 ? `翌${formatTime(date)}` : formatDateTime(date); };
// 予定変更の通知。閉じた後でも結果が分かるよう、新しい時刻を入れる。
const tripEndChangedMessage = (trip: Trip, end: string | Date) => `${trip.vehicle.name}の${trip.status === "IN_USE" ? "返却予定" : "終了予定"}を${formatDateTime(end)}に変更しました`;
const formatMinutes = (minutes: number) => minutes >= 60 ? `${Math.floor(minutes / 60)}時間${minutes % 60 ? `${minutes % 60}分` : ""}` : `${minutes}分`;
// 同じ車両の次の予約。延長できる上限と、超過が次の人へ響くかの判断に使う。
const nextReservationFor = (trip: Trip, reservations: Trip[]) => reservations.filter((item) => item.vehicleId === trip.vehicleId).sort((a, b) => a.plannedStart.localeCompare(b.plannedStart))[0] ?? null;
// 超過中は予定終了から延ばしても超過のままなので、今から指定時間後（5分単位で切り上げ）を新しい返却予定にする。
const extendedEnd = (trip: Trip, minutes: number, now: number) => { const end = new Date(trip.plannedEnd).getTime(); return end >= now ? end + minutes * 60_000 : Math.ceil((now + minutes * 60_000) / 300_000) * 300_000; };
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
const parkingSpotClass = (spot: ParkingSpot, offSite = false) => {
  const holding = spot.role === "HOLDING";
  // 車検などで外出中の車両は区画にいないため、破線で「戻るまで確保」を示す。
  if (offSite) return "border-[3px] border-dashed border-amber-400 bg-amber-50/70";
  // 一時区画も駐車中は通常区画と同じ実線にし、破線は空き区画と実在しない仮置きだけに残す。
  if (spot.vehicle?.status === "MAINTENANCE") return cn("border-slate-400 bg-slate-100", holding && "border-[3px] border-dashed");
  if (spot.vehicle) return cn("border-emerald-400 bg-emerald-50", holding && "border-[3px] border-dashed");
  return isDashedSpot(spot) ? "border-[3px] border-dashed border-slate-300/70 bg-slate-50/70" : "border-slate-300 bg-white/90";
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
  // 駐車場画面で利用中の車両タグをかざしたとき、配置図で返却先を選ぶよう伝える。nonceで同じ車両の再タッチも拾う。
  const [mapReturnRequest, setMapReturnRequest] = useState<{ tripId: string; nonce: number } | null>(null);
  const [returnSpot, setReturnSpot] = useState<ParkingSpot | null>(null);
  const [returnSpotId, setReturnSpotId] = useState("");
  const [changeReturnSpot, setChangeReturnSpot] = useState<(() => void) | null>(null);
  const [fuelVehicle, setFuelVehicle] = useState<Vehicle | null>(null);
  const [editTrip, setEditTrip] = useState<Trip | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error"; thanks?: string; brief?: boolean } | null>(null);
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
  const [timelineMode, setTimelineMode] = useState<"chart" | "list">("chart");
  const [changedVehicleIds, setChangedVehicleIds] = useState<string[]>([]);
  const vehicleVersions = useRef(new Map<string, number>());
  const [startContext, setStartContext] = useState<StartContext | null>(null);
  const [autoReturnSeconds, setAutoReturnSeconds] = useState<number | null>(null);
  const [stayOnTimeline, setStayOnTimeline] = useState(false);
  const [timelineDate, setTimelineDate] = useState(() => tokyoDayStart());
  const [timelineDays, setTimelineDays] = useState<1 | 3>(1);
  const nfcHealth = useNfcBridgeHealth(true);
  // 入口の共用端末では、駐車場・タイムライン画面を開いている間ずっと社員証・車両タグを受け付ける。
  // ダイアログ表示中（各ダイアログが自分で読み取る）と設定画面（NFC登録と競合する）では止める。
  const nfcAvailable = nfcHealth === "ready" || nfcHealth === "no-reader";
  // 利用者を残すか（各自のPC）、操作ごとに破棄するか（共用端末）。NFCを使えるかとは別に、端末ごとの指定で決める。
  const kiosk = isKioskDevice(useDeviceMode(), nfcHealth);
  const nfcListening = view === "parking" || view === "timeline";
  const kioskNfcHandler = useRef<((uid: string) => void) | null>(null);
  useNfcBridge(nfcAvailable && nfcListening && dialog === null && data !== null, (uid) => kioskNfcHandler.current?.(uid));
  // 社員証を読み直すたびに自動解除の残り時間を数え直す。
  const [authenticatedAt, setAuthenticatedAt] = useState(0);
  useEffect(() => {
    if (kiosk && forgetPersistentEmployee() && !readSavedEmployee()) setEmployee(null);
  }, [kiosk]);

  const load = useCallback(async (quiet = false) => {
    if (loadInFlight.current) return true;
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
    let cancelled = false;
    let timer = 0;
    let consecutiveFailures = 0;
    const poll = async () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        const ok = await load(true);
        consecutiveFailures = ok ? 0 : Math.min(consecutiveFailures + 1, 3);
      }
      if (!cancelled) {
        const delay = [5_000, 10_000, 30_000, 60_000][consecutiveFailures];
        timer = window.setTimeout(poll, delay);
      }
    };
    timer = window.setTimeout(poll, 5_000);
    return () => { cancelled = true; window.clearTimeout(timer); };
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
    const stored = readSavedEmployee();
    const saved = stored ? data.employees.find((person) => person.id === stored.id && person.active) ?? null : null;
    setEmployee(saved);
    if (saved && stored) saveEmployee(saved, stored.persistent);
    if (!saved && stored) clearSavedEmployee();
  }, [data?.employees]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("nfc") === "1" ? "nfc" : params.get("user") === "1" ? "user" : null;
    if (!requested) return;
    setDialog(requested);
    window.history.replaceState({}, "", "/");
  }, []);

  useEffect(() => {
    if (view !== "timeline") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("started") !== "1") return;
    setStayOnTimeline(false);
    setStartContext({ vehicleId: params.get("vehicleId") ?? "", employeeId: params.get("employeeId") ?? "" });
    window.history.replaceState({}, "", "/timeline");
  }, [view]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("idle") !== "1") return;
    setToast({ message: "安全のため駐車場画面へ戻り、利用者選択を解除しました", tone: "success" });
    window.history.replaceState({}, "", "/");
  }, []);

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
    // エラーは読み落とさないよう閉じるまで残す。ただしNFCをかざしたときの通知は、次の人の邪魔にならないよう6秒で消す。
    if (!toast || (toast.tone !== "success" && !toast.brief)) return;
    // お礼は読み切れるよう長めに残す。
    const timer = window.setTimeout(() => setToast(null), toast.thanks ? 7_000 : toast.brief ? 6_000 : 4_000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const resetKioskSession = () => {
    setEmployee(null);
    clearSavedEmployee();
    setDialog(null);
    setReturnTrip(null);
    setReturnSpot(null);
    setEditTrip(null);
  };
  // 各自のPCでは入力途中の画面も利用者も残す。リセットするのは入口の共用端末だけ。
  const idleWarningSeconds = useKioskIdle({
    enabled: kiosk && nfcListening,
    onReset: () => {
      resetKioskSession();
      if (window.location.pathname !== "/") window.location.assign("/?idle=1");
      else setToast({ message: "安全のため利用者選択と入力画面をリセットしました", tone: "success" });
    },
  });
  // 入口の共用端末では、認証した利用者を操作が途切れたら（初期値3分、端末ごとに変更可）解除し、次の人が前の人のまま操作しないようにする。
  const userTimeoutMinutes = useUserTimeoutMinutes();
  const userRemainingSeconds = useKioskUserTimeout({
    enabled: kiosk && nfcListening && employee !== null,
    timeoutMs: userTimeoutMinutes * 60_000,
    resetKey: `${employee?.id ?? ""}:${authenticatedAt}`,
    onTimeout: () => {
      resetKioskSession();
      setToast({ message: "操作がなかったため、利用者の選択を自動で解除しました", tone: "success" });
    },
  });

  const mutate = useCallback(async (body: object, success: string) => {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPendingAction(true);
    try {
      const operationId = createOperationId();
      const send = async () => {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 10_000);
        try {
          return await fetch("/api/dashboard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationId, actorEmployeeId: employee?.id, ...body }), signal: controller.signal });
        } finally {
          window.clearTimeout(timeout);
        }
      };
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
  const setupIncomplete = activeEmployees.length === 0 || activeVehicles.length === 0;
  const available = activeVehicles.filter((vehicle) => vehicle.status === "AVAILABLE");
  // 車検などで外出中の車両は区画を確保しているだけなので、駐車中に数えない。
  const offSiteVehicleIds = new Set(data.maintenances.filter((item) => item.status === "ACTIVE" && item.kind === "OFF_SITE").map((item) => item.vehicleId));
  const parkedCount = data.spots.reduce((count, spot) => count + (spot.vehicle && !offSiteVehicleIds.has(spot.vehicle.id) ? 1 : 0), 0);
  const confirmedTrip = startContext ? data.trips.find((trip) => trip.vehicleId === startContext.vehicleId && trip.employeeId === startContext.employeeId && trip.status === "IN_USE") : undefined;
  const openStart = (vehicle?: Vehicle) => { setSelectedVehicleId(vehicle?.id ?? ""); setDialog("start"); };
  const openEnd = (trip: Trip, spotId = "", changeSpot?: () => void) => { setReturnTrip(trip); setReturnSpotId(spotId); setChangeReturnSpot(changeSpot ? () => changeSpot : null); setDialog("end"); };
  const openParkingReturn = (spot: ParkingSpot) => { setReturnSpot(spot); setDialog("parkingReturn"); };
  const openFuel = (vehicle: Vehicle) => { setFuelVehicle(vehicle); setDialog("fuel"); };
  const openEdit = (trip: Trip) => { if (view === "timeline" && startContext) setStayOnTimeline(true); setEditTrip(trip); setDialog("edit"); };
  const completeReturn = async (trip: Trip, spotId: string, fuelLevel: number | null) => {
    const currentVehicle = data.vehicles.find((vehicle) => vehicle.id === trip.vehicleId);
    if (!currentVehicle) return false;
    const ok = await mutate({ action: "end", tripId: trip.id, tripVersion: trip.version, vehicleId: trip.vehicleId, vehicleVersion: currentVehicle.version, spotId, fuelLevel, actorName: employee?.name ?? "共用端末" }, "返却を登録しました。車両は利用可能です");
    // 給油して満タンで返してくれた人にだけお礼を目立たせて出す。出発時より増えていれば給油してくれたとみなす。
    if (ok && fuelLevel === FUEL_LEVEL_MAX && currentVehicle.fuelLevel !== null && currentVehicle.fuelLevel < FUEL_LEVEL_MAX) setToast({ message: "返却を登録しました。車両は利用可能です", tone: "success", thanks: "給油ありがとうございます！" });
    if (ok) setUndoReturn({ tripId: trip.id, vehicleId: trip.vehicleId, vehicleName: trip.vehicle.name, expiresAt: Date.now() + 5 * 60_000 });
    if (ok) finishKioskCheck();
    return ok;
  };
  const undoLastReturn = async () => {
    if (!undoReturn) return;
    const ok = await mutate({ action: "undoReturn", tripId: undoReturn.tripId, vehicleId: undoReturn.vehicleId, actorName: employee?.name ?? "共用端末" }, `${undoReturn.vehicleName}の返却を取り消し、利用中へ戻しました`);
    if (ok) setUndoReturn(null);
  };
  // 各自のPCでは「この端末の利用者」として残し、共用端末では社員証で確認した人を操作が終わるまでだけ持つ。
  const selectEmployee = (person: Employee) => {
    setEmployee(person);
    saveEmployee(person, !kiosk);
  };
  // 共用端末で利用開始・予約・返却を終えたら、次の人が前の人のまま操作しないよう確認を破棄する。
  function finishKioskCheck() {
    if (!kiosk) return;
    setEmployee(null);
    clearSavedEmployee();
  }
  const clearEmployee = () => {
    setEmployee(null);
    clearSavedEmployee();
    setToast({ message: "利用者の選択を解除しました", tone: "success" });
  };
  const openVehicleFromNfc = (vehicle: Vehicle) => {
    if (vehicle.status === "MAINTENANCE") { setToast({ message: `${vehicle.name}は整備中のため利用開始できません`, tone: "error", brief: true }); return; }
    const trip = activeTrips.find((item) => item.vehicleId === vehicle.id);
    if (trip && view === "parking") setMapReturnRequest({ tripId: trip.id, nonce: Date.now() });
    else if (trip) openEnd(trip);
    else openStart(vehicle);
  };
  const authenticateEmployee = (person: Employee) => {
    setAuthenticatedAt(Date.now());
    setToast({ message: employee?.id === person.id ? `${person.name}さんで認証済みです` : employee ? `利用者を${person.name}さんに切り替えました` : `${person.name}さんを認証しました`, tone: "success" });
    selectEmployee(person);
  };
  kioskNfcHandler.current = async (uid: string) => {
    try {
      const result = await resolveNfcUid(uid);
      const person = result?.kind === "employee" ? activeEmployees.find((item) => item.id === result.id) : undefined;
      if (person) { playNfcSound("success"); authenticateEmployee(person); return; }
      const vehicle = result?.kind === "vehicle" ? activeVehicles.find((item) => item.id === result.id) : undefined;
      if (vehicle) { playNfcSound(vehicle.status === "MAINTENANCE" ? "error" : "success"); openVehicleFromNfc(vehicle); return; }
      playNfcSound("error");
      setToast({ message: `登録されていないカード・タグです（UID ${uid}）`, tone: "error", brief: true });
    } catch { playNfcSound("error"); setToast({ message: "NFCタグを確認できませんでした。接続状態を確認してください", tone: "error", brief: true }); }
  };
  const downloadDiagnostics = () => {
    const diagnostics = {
      checkedAt: new Date().toISOString(),
      page: view,
      application: syncState,
      online: isOnline,
      lastSuccessfulSync: lastSuccessfulSync?.toISOString() ?? null,
      nfcBridge: nfcHealth,
      appVersion: data.system.appVersion,
      environment: data.system.environment,
      deployedAt: data.system.deployedAt,
      backupLatestAt: data.system.backupLatestAt,
      backupVerifiedAt: data.system.backupVerifiedAt,
      userAgent: navigator.userAgent,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(diagnostics, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `fleetflow-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setToast({ message: "診断情報を保存しました", tone: "success" });
  };

  return (
    <div className="min-h-screen bg-[#f4f7fb] text-slate-900">
      <AppHeader view={view} actions={<>
            <HeaderSystemStatus syncState={syncState} lastSuccessfulSync={lastSuccessfulSync} nfcStatus={nfcHealth} refreshing={refreshing} onRefresh={() => void load()} onOpenNfc={() => setDialog("nfc")} onDownloadDiagnostics={downloadDiagnostics} />
            <HeaderDeviceMode nfcStatus={nfcHealth} />
            <HeaderUserControl nfcStatus={nfcHealth} nfcListening={nfcListening} employeeName={employee?.name ?? null} remainingSeconds={userRemainingSeconds} onPick={() => setDialog("user")} onClear={clearEmployee} />
            <button aria-label="最新情報に更新" aria-busy={refreshing} disabled={refreshing} onClick={() => void load()} className="grid size-11 place-items-center rounded-xl border border-slate-200 bg-white disabled:opacity-50"><RefreshCw className={cn("size-4", refreshing && "animate-spin")} /></button>
      </>} />

      <main className="mx-auto max-w-[1600px] space-y-5 p-4 pb-28 md:p-8">
        {/* 配置図では通知を見出しバーの中央に出し、地図の位置がずれないようにする。 */}
        {view !== "parking" ? <>
          {!isOnline ? <Card role="alert" className="flex flex-wrap items-center gap-3 border-amber-300 bg-amber-50 p-3 text-amber-950"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-amber-500 text-white"><AlertTriangle className="size-4" /></span><div className="mr-auto"><p className="text-sm font-black">オフラインです</p><p className="text-xs text-amber-800">表示中の情報は更新されません。接続が戻ると自動的に再同期します。</p></div></Card> : null}
          {syncState === "stale" ? <Card role="alert" className="flex flex-wrap items-center gap-3 border-rose-300 bg-rose-50 p-3 text-rose-950"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-rose-600 text-white"><AlertTriangle className="size-4" /></span><div className="mr-auto min-w-0"><p className="text-sm font-black">自動更新が停止しています</p><p className="text-xs text-rose-800">{lastSuccessfulSync ? `最終更新 ${jpTimeSeconds.format(lastSuccessfulSync)}。前回取得した情報を表示しています。` : "最新情報を取得できていません。"}</p></div><Button variant="danger" disabled={refreshing} onClick={() => void load()}>{refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}{refreshing ? "再接続中…" : "再接続"}</Button></Card> : null}
          <OperationalAlerts data={data} />
          {undoReturn ? <Card className="flex flex-wrap items-center gap-3 border-amber-300 bg-amber-50 p-3 text-amber-950"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-amber-500 text-white"><AlertTriangle className="size-4" /></span><div className="mr-auto min-w-0"><p className="text-sm font-black">{undoReturn.vehicleName}を返却しました</p><p className="text-xs text-amber-800">間違えた場合は5分以内に取り消せます</p></div><Button variant="secondary" className="border-amber-300 bg-white text-amber-900 hover:bg-amber-100" disabled={pendingAction} onClick={undoLastReturn}>返却を取り消す</Button><button type="button" aria-label="返却取消の案内を閉じる" onClick={() => setUndoReturn(null)} className="grid size-9 place-items-center rounded-lg text-amber-700 hover:bg-amber-100"><X className="size-4" /></button></Card> : null}
        </> : null}
        {view === "parking" ? <section className="space-y-3 md:-mt-3">
          {setupIncomplete ? <InitialSetupGuide hasEmployees={activeEmployees.length > 0} hasVehicles={activeVehicles.length > 0} /> : null}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm md:px-4">
            <div className="flex min-h-6 flex-1 items-center md:basis-0"><div className="flex items-baseline gap-x-2 whitespace-nowrap"><h2 className="text-sm font-black">社屋隣接駐車場</h2><span aria-live="polite" className="text-xs font-bold text-emerald-700">駐車中 {parkedCount}台</span></div></div>
            <div className="flex min-w-0 flex-wrap items-center justify-center gap-1.5">
              {!isOnline ? <span role="alert" title="接続が戻ると自動的に再同期します" className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold border-amber-300 bg-amber-50 text-amber-950"><AlertTriangle className="size-3.5 shrink-0" />オフライン（表示は更新されません）</span> : null}
              {isOnline && syncState === "stale" ? <span role="alert" className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold border-rose-300 bg-rose-50 text-rose-900"><AlertTriangle className="size-3.5 shrink-0" />自動更新停止{lastSuccessfulSync ? `（最終 ${jpTimeSeconds.format(lastSuccessfulSync)}）` : ""}<button type="button" disabled={refreshing} onClick={() => void load()} className="ml-0.5 inline-flex items-center gap-1 rounded-full bg-rose-600 px-2 py-0.5 text-white hover:bg-rose-700 disabled:opacity-60">{refreshing ? <LoaderCircle className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}{refreshing ? "再接続中…" : "再接続"}</button></span> : null}
              <OperationalAlerts data={data} compact />
              {undoReturn ? <span title="間違えた場合は5分以内に取り消せます" className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold border-amber-300 bg-amber-50 text-amber-950">{undoReturn.vehicleName}を返却しました<button type="button" disabled={pendingAction} onClick={undoLastReturn} className="ml-0.5 rounded-full border border-amber-300 bg-white px-2 py-0.5 text-amber-900 hover:bg-amber-100 disabled:opacity-60">取り消す</button><button type="button" aria-label="返却取消の案内を閉じる" onClick={() => setUndoReturn(null)} className="grid size-5 place-items-center rounded-full text-amber-700 hover:bg-amber-100"><X className="size-3.5" /></button></span> : null}
            </div>
            <div aria-hidden className="hidden flex-1 basis-0 md:block" />
          </div>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px]">
            <ParkingMap data={data} trips={activeTrips} changedVehicleIds={changedVehicleIds} mutate={mutate} openStart={openStart} openReturn={openParkingReturn} openFuel={openFuel} openEdit={openEdit} openEnd={openEnd} actorName={employee?.name ?? "共用端末"} currentEmployeeId={employee?.id ?? null} returnRequest={mapReturnRequest} />
          </div>
        </section> : null}

        {view === "timeline" ? <>
          {startContext ? <Card className="flex flex-wrap items-center gap-3 border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-emerald-600 text-white"><Check className="size-5" /></span>
            <div className="min-w-0 flex-1"><p className="font-black">利用開始を登録しました</p><p className="mt-0.5 text-sm text-emerald-700">{confirmedTrip ? `${confirmedTrip.vehicle.name} ・ ${confirmedTrip.employee.name} ・ ${formatDateTime(confirmedTrip.actualStart ?? confirmedTrip.plannedStart)}〜${formatDateTime(confirmedTrip.plannedEnd)}` : "登録内容がタイムラインに反映されています。"}</p><p className="mt-1 text-xs font-bold text-emerald-800">{stayOnTimeline ? "自動移動を停止しました。続けて予定を修正できます。" : `${autoReturnSeconds ?? 5}秒後に駐車場へ戻ります。画面を操作すると停止します。`}</p></div>
            <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setStayOnTimeline(true)} disabled={stayOnTimeline} className="rounded-xl px-3 py-2 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100 disabled:text-emerald-500">タイムラインに留まる</button><Link href="/" className="rounded-xl border border-emerald-300 bg-white px-4 py-2 text-sm font-bold text-emerald-800 transition hover:bg-emerald-100">今すぐ駐車場へ戻る</Link></div>
          </Card> : null}
          {activeVehicles.length === 0 ? <TimelineEmptyState /> : <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            {timelineMode === "chart" ? <Card className="min-w-0 overflow-hidden"><TimelinePanelHeader mode={timelineMode} onChange={setTimelineMode} /><Timeline data={data} mutate={mutate} openStart={openStart} openEdit={openEdit} actorName={employee?.name ?? "共用端末"} highlightTripId={confirmedTrip?.id} timelineDate={timelineDate} timelineDays={timelineDays} setTimelineDate={setTimelineDate} setTimelineDays={setTimelineDays} /></Card> : <TimelineList trips={data.trips} openEdit={openEdit} mode={timelineMode} onChange={setTimelineMode} timelineDate={timelineDate} timelineDays={timelineDays} setTimelineDate={setTimelineDate} setTimelineDays={setTimelineDays} />}
            <ActiveTripsPanel trips={activeTrips} reservations={data.nextReservations} mutate={mutate} actorName={employee?.name ?? "共用端末"} openEdit={openEdit} />
          </section>}
        </> : null}

        {view === "settingsEmployees" || view === "settingsDepartments" || view === "settingsVehicles" || view === "settingsSpots" || view === "settingsData" ? <div className="space-y-5">
            <PageHeading eyebrow="管理設定" title={view === "settingsEmployees" ? "社員登録" : view === "settingsDepartments" ? "部署" : view === "settingsVehicles" ? "車両登録" : view === "settingsSpots" ? "駐車区画" : "データ保存・復元"} description={view === "settingsEmployees" ? "利用者となる社員と社員証のNFCタグを登録します。" : view === "settingsDepartments" ? "社員が所属する部署の追加・名前の変更・並び順を管理します。" : view === "settingsVehicles" ? "利用する社用車と車両のNFCタグを登録します。" : view === "settingsSpots" ? "配置図で区画を選び、区画番号と用途（一時・お客様用・専用・仮置き）を変更します。" : "FleetFlowの全データをJSONで保存し、必要なときに一括復元します。"} />
            <SettingsNavigation view={view} />
            {view === "settingsData" ? <DataBackupPanel /> : view === "settingsSpots" ? <SpotRoleSettings data={data} mutate={mutate} /> : view === "settingsDepartments" ? <DepartmentSettings data={data} mutate={mutate} /> : <><div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-xs font-bold text-blue-600">日常管理</p><h3 className="mt-0.5 text-lg font-black">{view === "settingsEmployees" ? "社員情報" : "車両情報"}</h3></div><p className="text-xs text-slate-500">検索・登録・変更をこの一覧から行えます</p></div><SettingsPanelV2 kind={view === "settingsEmployees" ? "employee" : "vehicle"} data={data} mutate={mutate} /></>}
            <AdminToolsPanel />
          </div> : null}
      </main>

      {dialog === "nfc" && <NfcDialog employees={activeEmployees} vehicles={activeVehicles} onEmployee={(person) => { authenticateEmployee(person); setDialog(null); }} onVehicle={(vehicle) => { setDialog(null); openVehicleFromNfc(vehicle); }} onClose={() => setDialog(null)} />}
      {dialog === "user" && <UserPickerDialog employees={activeEmployees} currentId={employee?.id ?? null} nfcEnabled={nfcAvailable} onSelect={(person) => { authenticateEmployee(person); setDialog(null); }} onClose={() => setDialog(null)} />}
      {dialog === "start" && <StartDialog submitting={pendingAction} employees={activeEmployees} vehicles={available} trips={data.trips} initialEmployee={employee?.active ? employee : null} initialVehicleId={selectedVehicleId} onClose={() => setDialog(null)} onSubmit={async (values) => { const identifiedEmployee = activeEmployees.find((person) => person.id === values.employeeId) ?? null; const scheduled = values.plannedStart !== null; const ok = await mutate(scheduled ? { action: "reserve", employeeId: values.employeeId, vehicleId: values.vehicleId, plannedStart: values.plannedStart!, minutes: values.minutes, actorName: values.employeeName, actorEmployeeId: values.employeeId } : { action: "start", employeeId: values.employeeId, vehicleId: values.vehicleId, minutes: values.minutes, actorName: values.employeeName, actorEmployeeId: values.employeeId }, scheduled ? "予約を登録しました" : "利用を開始しました"); if (ok && identifiedEmployee) { if (kiosk) finishKioskCheck(); else if (!employee) selectEmployee(identifiedEmployee); setDialog(null); if (!scheduled) window.location.assign(`/timeline?started=1&vehicleId=${encodeURIComponent(values.vehicleId)}&employeeId=${encodeURIComponent(values.employeeId)}`); } }} />}
      {dialog === "end" && returnTrip && <EndDialog submitting={pendingAction} trip={returnTrip} spots={data.spots} initialSpotId={returnSpotId} onChangeSpot={changeReturnSpot ? () => { setDialog(null); changeReturnSpot(); } : undefined} onClose={() => setDialog(null)} onSubmit={async (spotId, fuelLevel) => { const ok = await completeReturn(returnTrip, spotId, fuelLevel); if (ok) setDialog(null); }} />}
      {dialog === "parkingReturn" && returnSpot && <ParkingReturnDialog submitting={pendingAction} spot={returnSpot} trips={activeTrips} vehicles={data.vehicles} onClose={() => setDialog(null)} onSubmit={async (trip, fuelLevel) => { const ok = await completeReturn(trip, returnSpot.id, fuelLevel); if (ok) { setDialog(null); setReturnSpot(null); } }} />}
      {dialog === "fuel" && fuelVehicle && <FuelLevelDialog submitting={pendingAction} vehicle={fuelVehicle} onClose={() => setDialog(null)} onSubmit={async (fuelLevel) => { const ok = await mutate({ action: "setFuelLevel", vehicleId: fuelVehicle.id, version: fuelVehicle.version, fuelLevel, actorName: employee?.name ?? "共用端末" }, `${fuelVehicle.name}の残量を${formatFuelLevel(fuelLevel)}へ変更しました`); if (ok) setDialog(null); }} />}
      {dialog === "edit" && editTrip && <EditTripDialog submitting={pendingAction} trip={editTrip} onClose={() => setDialog(null)} onAdjust={async (minutes) => { const ok = await mutate({ action: "adjustTrip", tripId: editTrip.id, version: editTrip.version, minutes, actorName: employee?.name ?? "共用端末" }, tripEndChangedMessage(editTrip, new Date(new Date(editTrip.plannedEnd).getTime() + minutes * 60_000))); if (ok) { setDialog(null); if (startContext) setStayOnTimeline(false); } }} onSetEnd={async (plannedEnd) => { const ok = await mutate({ action: "setTripEnd", tripId: editTrip.id, version: editTrip.version, plannedEnd, actorName: employee?.name ?? "共用端末" }, tripEndChangedMessage(editTrip, plannedEnd)); if (ok) { setDialog(null); if (startContext) setStayOnTimeline(false); } }} onCancel={async () => { const ok = await mutate({ action: "cancelTrip", tripId: editTrip.id, version: editTrip.version, actorName: employee?.name ?? "共用端末" }, `${editTrip.vehicle.name}の予約を取り消しました`); if (ok) setDialog(null); }} />}
      {pendingAction ? <div className="fixed left-0 top-0 z-[80] h-1 w-full overflow-hidden bg-blue-100"><div className="h-full w-1/2 animate-pulse bg-blue-600" /></div> : null}
      {idleWarningSeconds !== null ? <div role="alert" className="fixed bottom-24 left-1/2 z-[75] flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 shadow-2xl md:bottom-5"><AlertTriangle className="size-5 shrink-0 text-amber-600" /><div><p className="text-sm font-black">まもなく共用端末をリセットします</p><p className="text-xs text-amber-800">あと{idleWarningSeconds}秒。画面を操作すると継続できます。</p></div></div> : null}
      {toast ? <div role={toast.tone === "error" ? "alert" : "status"} className={cn("fixed bottom-24 left-1/2 z-[70] flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white shadow-2xl md:bottom-5", toast.tone === "error" ? "bg-rose-700" : "bg-slate-950")} >{toast.tone === "error" ? <AlertTriangle className="size-4 shrink-0" /> : <Check className="size-4 shrink-0" />}<span className="flex flex-col gap-1"><span>{toast.message}</span>{toast.thanks ? <span className="flex items-center gap-1.5 text-base font-black text-emerald-300"><Fuel className="size-5 shrink-0" />{toast.thanks}</span> : null}</span><button type="button" aria-label={toast.tone === "error" ? "エラー通知を閉じる" : "完了通知を閉じる"} onClick={() => setToast(null)} className="ml-1 grid size-7 shrink-0 place-items-center rounded-lg bg-white/15 hover:bg-white/25"><X className="size-3.5" /></button></div> : null}
      <Navigation view={view} className="fixed inset-x-3 bottom-3 z-40 flex rounded-2xl border border-slate-200 bg-white/95 p-1.5 shadow-2xl backdrop-blur md:hidden" />
    </div>
  );
}

function Loading({ view }: { view: DashboardView }) { return <div className="min-h-screen bg-[#f4f7fb]"><header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3 px-4 py-3 md:px-8"><div className="flex items-center gap-3"><div className="grid size-11 place-items-center rounded-2xl bg-blue-600 text-white"><CarFront /></div><div><p className="text-lg font-black">FleetFlow</p><p className="hidden text-xs text-slate-500 sm:block">社用車 利用・駐車管理</p></div></div><Navigation view={view} className="hidden md:flex" /></div></header><main className="mx-auto max-w-[1600px] space-y-5 p-4 pb-28 md:p-8"><div className="h-7 w-52 animate-pulse rounded-lg bg-slate-200" /><div className="grid gap-3 sm:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}</div><div className="grid min-h-64 place-items-center rounded-2xl border border-slate-200 bg-white"><div className="text-center"><RefreshCw className="mx-auto size-8 animate-spin text-blue-600" /><p className="mt-3 text-sm font-bold text-slate-600">車両情報を読み込み中</p></div></div></main><Navigation view={view} className="fixed inset-x-3 bottom-3 z-40 flex rounded-2xl border border-slate-200 bg-white/95 p-1.5 shadow-2xl backdrop-blur md:hidden" /></div>; }

function InitialLoadError({ view, refreshing, onRetry }: { view: DashboardView; refreshing: boolean; onRetry: () => void }) {
  return <div className="min-h-screen bg-[#f4f7fb]"><header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3 px-4 py-3 md:px-8"><div className="flex items-center gap-3"><div className="grid size-11 place-items-center rounded-2xl bg-blue-600 text-white"><CarFront /></div><p className="text-lg font-black">FleetFlow</p></div><Navigation view={view} className="hidden md:flex" /></div></header><main className="grid min-h-[calc(100vh-72px)] place-items-center p-4 pb-28"><Card role="alert" className="w-full max-w-lg p-6 text-center"><span className="mx-auto grid size-12 place-items-center rounded-full bg-rose-100 text-rose-700"><AlertTriangle className="size-6" /></span><h1 className="mt-4 text-xl font-black">FleetFlowに接続できません</h1><p className="mt-2 text-sm leading-6 text-slate-600">Dockerとデータベースの起動状態を確認してください。接続が戻ったら再試行できます。</p><Button className="mt-5 w-full" disabled={refreshing} onClick={onRetry}>{refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}{refreshing ? "接続中…" : "再接続"}</Button></Card></main><Navigation view={view} className="fixed inset-x-3 bottom-3 z-40 flex rounded-2xl border border-slate-200 bg-white/95 p-1.5 shadow-2xl backdrop-blur md:hidden" /></div>;
}

function OperationalAlerts({ data, compact = false }: { data: DashboardData; compact?: boolean }) {
  const now = Date.now();
  const overdue = data.trips.filter((trip) => trip.status === "IN_USE" && new Date(trip.plannedEnd).getTime() < now).length;
  const unlocated = data.vehicles.filter((vehicle) => vehicle.active && vehicle.status === "AVAILABLE" && !vehicle.parkingSpotId).length;
  const backupOld = !data.system.backupLatestAt || now - new Date(data.system.backupLatestAt).getTime() > 26 * 60 * 60_000;
  const verificationOld = !data.system.backupVerifiedAt || now - new Date(data.system.backupVerifiedAt).getTime() > 26 * 60 * 60_000;
  const alerts = [
    overdue ? { label: `返却予定を超過 ${overdue}台`, href: "/timeline" } : null,
    unlocated ? { label: `駐車位置未確定 ${unlocated}台`, href: "/" } : null,
    backupOld || verificationOld ? { label: backupOld ? "DBバックアップを確認できません" : "バックアップ復元確認が古くなっています", href: "/operations" } : null,
  ].filter((item): item is { label: string; href: string } => item !== null);
  if (alerts.length === 0) return null;
  if (compact) return <>{alerts.map((alert) => <Link key={alert.label} role="status" href={alert.href} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold border-amber-300 bg-amber-50 text-amber-950 hover:border-amber-500"><AlertTriangle className="size-3.5 shrink-0" />{alert.label}</Link>)}</>;
  return <Card role="status" className="flex flex-wrap items-center gap-2 border-amber-300 bg-amber-50 p-3"><span className="mr-1 inline-flex items-center gap-2 text-sm font-black text-amber-950"><AlertTriangle className="size-4" />確認が必要</span>{alerts.map((alert) => <Link key={alert.label} href={alert.href} className="rounded-full border border-amber-200 bg-white px-3 py-1.5 text-xs font-bold text-amber-900 hover:border-amber-400">{alert.label}</Link>)}</Card>;
}

function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div><p className="text-xs font-bold text-blue-600">{eyebrow}</p><h2 className="mt-1 text-2xl font-black">{title}</h2><p className="mt-1 text-sm text-slate-500">{description}</p></div>;
}

function InitialSetupGuide({ hasEmployees, hasVehicles }: { hasEmployees: boolean; hasVehicles: boolean }) {
  const steps = [
    { done: hasEmployees, label: "社員を登録", href: "/settings/employees", icon: <UserRound className="size-4" /> },
    { done: hasVehicles, label: "車両を登録", href: "/settings/vehicles", icon: <CarFront className="size-4" /> },
    { done: hasEmployees && hasVehicles, label: "NFC・装備を確認", href: "/settings/vehicles", icon: <Nfc className="size-4" /> },
  ];
  return <Card className="flex flex-wrap items-center gap-3 border-blue-200 bg-blue-50/70 px-4 py-3"><div className="mr-auto min-w-56"><p className="text-sm font-black text-blue-950">最初に利用情報を登録してください</p><p className="text-[11px] text-blue-700">登録後、配置図とタイムラインから日常操作を開始できます。</p></div><ol className="flex flex-wrap gap-2">{steps.map((step, index) => <li key={step.label}><Link href={step.href} className={cn("inline-flex min-h-9 items-center gap-2 rounded-xl border px-3 text-xs font-bold transition", step.done ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-blue-200 bg-white text-blue-800 hover:border-blue-400")}><span className={cn("grid size-5 place-items-center rounded-full text-[10px]", step.done ? "bg-emerald-600 text-white" : "bg-blue-100 text-blue-700")}>{step.done ? <Check className="size-3" /> : index + 1}</span>{step.icon}{step.label}</Link></li>)}</ol></Card>;
}

function TimelineEmptyState() {
  return <Card className="grid min-h-72 place-items-center p-6 text-center"><div><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-blue-50 text-blue-600"><Clock3 className="size-7" /></span><h2 className="mt-4 text-lg font-black">表示する車両がありません</h2><p className="mt-1 text-sm text-slate-500">車両を登録すると、利用予定と現在の利用状況を確認できます。</p><div className="mt-5 flex flex-wrap justify-center gap-2"><Link href="/settings/vehicles" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700"><Plus className="size-4" />車両を登録</Link><Link href="/" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50"><LayoutGrid className="size-4" />駐車場を見る</Link></div></div></Card>;
}

// タイムライン右の利用中の車両。超過した人から連絡を受けた社内の人が、延長や予定変更をここで済ませる。
// 台数が多くても見渡せるよう1台1行にし、操作はタップして開いた行にだけ出す。返却は駐車場の配置図で区画を選んで行う。
function ActiveTripsPanel({ trips, reservations, mutate, actorName, openEdit }: { trips: Trip[]; reservations: Trip[]; mutate: (body: object, success: string) => Promise<boolean>; actorName: string; openEdit: (trip: Trip) => void }) {
  const [openTripId, setOpenTripId] = useState<string | null>(null);
  const now = new Date();
  const inUse = [...trips].sort((a, b) => a.plannedEnd.localeCompare(b.plannedEnd));
  return <Card className="overflow-hidden xl:relative">
    <div className="flex flex-col xl:absolute xl:inset-0">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2"><h2 className="text-sm font-black">利用中</h2><span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-black text-blue-700">{inUse.length}台</span></div>
      {inUse.length === 0 ? <p className="px-3 py-6 text-center text-xs text-slate-400">現在利用中の車両はありません</p> : <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">{inUse.map((trip) => {
        const end = new Date(trip.plannedEnd).getTime();
        const overdue = end < now.getTime();
        const next = nextReservationFor(trip, reservations);
        // 次の予約までの残り。超過中は今からの残り時間で見る。1時間を切ったら行にも印を出す。
        const gap = next ? Math.floor((new Date(next.plannedStart).getTime() - Math.max(end, now.getTime())) / 60_000) : null;
        const tight = gap !== null && gap < 60;
        const open = trip.id === openTripId;
        return <li key={trip.id} className={cn(overdue && "bg-rose-50/60")}>
          <button type="button" aria-expanded={open} onClick={() => setOpenTripId(open ? null : trip.id)} className={cn("flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-slate-50", open && "bg-blue-50 hover:bg-blue-50")}>
            <CarFront className="size-4 shrink-0" style={{ color: trip.vehicle.color }} />
            <span className="min-w-0 flex-1 truncate text-xs"><b className="font-black">{trip.vehicle.name}</b><span className="ml-1.5 text-slate-500">{trip.employee.name}</span></span>
            {tight && next ? <span title={`次の予約 ${formatDateTime(next.plannedStart)} ${next.employee.name}`} className="flex shrink-0 items-center gap-0.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-black text-amber-900"><CalendarClock className="size-3" />{gap !== null && gap <= 0 ? "次の予約と重複" : `次まで${formatMinutes(gap ?? 0)}`}</span> : null}
            {overdue ? <span className="shrink-0 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-black text-rose-700">超過{formatMinutes(Math.max(1, Math.floor((now.getTime() - end) / 60_000)))}</span> : <span className="shrink-0 text-[11px] font-bold tabular-nums text-slate-600">{formatShortTime(trip.plannedEnd, now)}</span>}
            <ChevronDown className={cn("size-3.5 shrink-0 text-slate-400 transition", open && "rotate-180")} />
          </button>
          {open ? <div className="space-y-1.5 px-3 pb-2.5 pt-1">
            <p className="text-[11px] text-slate-500">{trip.employee.department} ・ 返却予定 <span className={cn("font-bold", overdue ? "text-rose-700" : "text-slate-700")}>{formatDateTime(trip.plannedEnd)}</span></p>
            {next ? <p className={cn("flex items-center gap-1 text-[11px] font-bold", tight ? "text-amber-900" : "text-slate-500")}><CalendarClock className="size-3.5 shrink-0" /><span className="truncate">次の予約 {formatDateTime(next.plannedStart)} {next.employee.name}{tight ? gap <= 0 ? "（開始時刻を過ぎています）" : `（あと${formatMinutes(gap)}）` : ""}</span></p> : null}
            <div className="flex flex-wrap items-center gap-1"><TripExtendButtons trip={trip} reservations={reservations} minutes={[30, 60]} mutate={mutate} actorName={actorName} className="min-h-8 bg-white px-2 text-xs" /><Button variant="ghost" className="min-h-8 px-2 text-xs" onClick={() => openEdit(trip)}><Pencil className="size-3.5" />予定変更</Button><Link href={`/?returnTrip=${trip.id}`} className="ml-auto inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-[11px] font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-800"><LogOut className="size-3.5" />駐車場で返却</Link></div>
          </div> : null}
        </li>;
      })}</ul>}
    </div>
  </Card>;
}

// 返却予定の延長ボタン。次の予約や7日の上限を越える延長は押せない。
function TripExtendButtons({ trip, reservations, minutes, mutate, actorName, className }: { trip: Trip; reservations: Trip[]; minutes: number[]; mutate: (body: object, success: string) => Promise<boolean>; actorName: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const now = Date.now();
  const overdue = new Date(trip.plannedEnd).getTime() < now;
  const next = nextReservationFor(trip, reservations);
  const limit = Math.min(new Date(trip.plannedStart).getTime() + 7 * 24 * 60 * 60_000, next ? new Date(next.plannedStart).getTime() : Infinity);
  const extend = async (value: number) => {
    const end = extendedEnd(trip, value, Date.now());
    setBusy(true);
    try {
      await mutate(overdue ? { action: "setTripEnd", tripId: trip.id, version: trip.version, plannedEnd: new Date(end).toISOString(), actorName } : { action: "adjustTrip", tripId: trip.id, version: trip.version, minutes: value, actorName }, `${trip.vehicle.name}の返却予定を${formatDateTime(new Date(end))}に延長しました`);
    } finally { setBusy(false); }
  };
  return <>{minutes.map((value) => <Button key={value} variant="ghost" className={className} title={overdue ? `返却予定を今から${formatMinutes(value)}後にする` : `返却予定を${formatMinutes(value)}延長`} disabled={busy || extendedEnd(trip, value, now) > limit} onClick={() => void extend(value)}>{overdue ? "今から" : "＋"}{formatMinutes(value)}</Button>)}</>;
}
function Legend({ color, label }: { color: string; label: string }) { return <span className="flex items-center gap-1.5"><i className={cn("size-2 rounded-full", color)} />{label}</span>; }
function Empty({ label }: { label: string }) { return <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-400">{label}</div>; }

function ViewSwitch<T extends string>({ value, onChange, first, second, compact = false }: { value: T; onChange: (value: T) => void; first: { value: T; label: string; icon: React.ReactNode }; second: { value: T; label: string; icon: React.ReactNode }; compact?: boolean }) {
  return <div className="inline-flex w-fit rounded-xl border border-slate-200 bg-white p-1 shadow-sm">{[first, second].map((item) => <button key={item.value} type="button" onClick={() => onChange(item.value)} aria-pressed={value === item.value} className={cn("inline-flex items-center gap-2 rounded-lg font-bold transition", compact ? "min-h-7 px-2.5 text-xs" : "min-h-10 px-4 text-sm", value === item.value ? "bg-slate-900 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50")} >{item.icon}{item.label}</button>)}</div>;
}

function TimelinePanelHeader({ mode, onChange }: { mode: "chart" | "list"; onChange: (mode: "chart" | "list") => void }) {
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-100 px-4 py-2.5"><ViewSwitch value={mode} onChange={onChange} first={{ value: "chart", label: "タイムライン", icon: <Clock3 className="size-4" /> }} second={{ value: "list", label: "予約一覧", icon: <List className="size-4" /> }} compact /><p className="mr-auto text-xs text-slate-500">{mode === "chart" ? "ドラッグまたは予定をタップして時間を変更" : "予約を選ぶと時間の変更や取消ができます"}</p>{mode === "chart" ? <div className="flex shrink-0 gap-3 text-xs"><Legend color="bg-blue-500" label="利用中" /><Legend color="bg-violet-500" label="予約" /><Legend color="bg-slate-400" label="完了" /><Legend color="bg-amber-400" label="整備" /></div> : null}</div>;
}

// タイムラインと予約一覧で共通の期間切り替え。
function TimelineDateNav({ timelineDate, timelineDays, setTimelineDate, setTimelineDays, children }: { timelineDate: Date; timelineDays: 1 | 3; setTimelineDate: React.Dispatch<React.SetStateAction<Date>>; setTimelineDays: React.Dispatch<React.SetStateAction<1 | 3>>; children?: React.ReactNode }) {
  const moveDay = (amount: number) => setTimelineDate((current) => new Date(current.getTime() + amount * 24 * 60 * 60_000));
  return <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 p-3">
    <div className="flex items-center gap-1"><button aria-label="前日" onClick={() => moveDay(-1)} className="grid size-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"><ChevronLeft className="size-4" /></button><button onClick={() => setTimelineDate(tokyoDayStart())} className="min-h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50">今日</button><button aria-label="翌日" onClick={() => moveDay(1)} className="grid size-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"><ChevronRight className="size-4" /></button><span className="ml-2 text-sm font-black">{jpShortDate.format(timelineDate)}{timelineDays === 3 ? `〜${jpShortDate.format(new Date(timelineDate.getTime() + 2 * 24 * 60 * 60_000))}` : ""}</span></div>
    <div className="flex items-center gap-2">{children}<div className="flex rounded-xl bg-slate-200 p-1"><button onClick={() => setTimelineDays(1)} className={cn("min-h-8 rounded-lg px-3 text-xs font-bold", timelineDays === 1 ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>1日</button><button onClick={() => setTimelineDays(3)} className={cn("min-h-8 rounded-lg px-3 text-xs font-bold", timelineDays === 3 ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>3日</button></div></div>
  </div>;
}

type OffSiteEntry = { maintenance: VehicleMaintenance; vehicle: Vehicle; spotCode: string | null };
// 配置図の右に常時表示する利用中の車両。タップで詳細を開き、配置図の空き区画へドラッグすると返却できる。
// 車検・修理で外出中の車両も下に並べ、タップで「戻った」の画面を開く。
// 「後で設定」で登録した車など位置未設定の車両も並べ、タップで置く区画を選ぶ（空き区画へドラッグも可）。
// 位置未設定でも利用開始はできるため、その場で利用開始もできる。
function ActiveVehicleSidebar({ trips, mineEmployeeId, offSite, unplaced, selectedTripId, returningTripId, placingVehicleId, onSelect, onSelectOffSite, onPlace, onStart, onDragStart, onDragEnd }: { trips: Trip[]; mineEmployeeId: string | null; offSite: OffSiteEntry[]; unplaced: Vehicle[]; selectedTripId: string | null; returningTripId: string | null; placingVehicleId: string | null; onSelect: (trip: Trip) => void; onSelectOffSite: (vehicle: Vehicle) => void; onPlace: (vehicle: Vehicle) => void; onStart: (vehicle: Vehicle) => void; onDragStart: (trip: Trip) => void; onDragEnd: () => void }) {
  const now = Date.now();
  // 選んでいる利用者の車両を一番上に出し、あとはタイムラインの「利用中」と同じく返却予定が近い順（超過は上）に並べる。
  const isMine = (trip: Trip) => mineEmployeeId !== null && trip.employeeId === mineEmployeeId;
  const inUse = [...trips].sort((a, b) => Number(isMine(b)) - Number(isMine(a)) || a.plannedEnd.localeCompare(b.plannedEnd));
  return <Card className="overflow-hidden lg:relative">
    <div className="flex flex-col lg:absolute lg:inset-0">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2"><h3 className="text-xs font-black">利用中の車両</h3><span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-700">{trips.length}台</span></div>
      <div className="min-h-0 flex-1 overflow-y-auto">
      {trips.length === 0 ? <p className="px-3 py-6 text-center text-xs text-slate-400">現在利用中の車両はありません</p> : <ul className="divide-y divide-slate-100">{inUse.map((trip) => {
        const overdue = new Date(trip.plannedEnd).getTime() < now;
        const mine = isMine(trip);
        return <li key={trip.id}><button type="button" draggable aria-pressed={trip.id === selectedTripId} title={`${trip.vehicle.name}の詳細を表示（空き区画へドラッグすると返却）`} onClick={() => onSelect(trip)} onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", trip.vehicle.name); onDragStart(trip); }} onDragEnd={onDragEnd} className={cn("flex w-full cursor-grab items-center gap-2 px-3 py-2 text-left transition hover:bg-slate-50 active:cursor-grabbing", overdue && "bg-rose-50/70", mine && "border-l-4 border-blue-500 bg-blue-50/50 pl-2", (trip.id === selectedTripId || trip.id === returningTripId) && "bg-blue-50 ring-2 ring-inset ring-blue-300")}>
          <CarFront className="size-4 shrink-0" style={{ color: trip.vehicle.color }} />
          <div className="min-w-0 flex-1"><p className="flex min-w-0 items-center gap-1.5 text-xs font-black"><span className="truncate">{trip.vehicle.name}</span>{mine ? <span className="shrink-0 rounded bg-blue-600 px-1 py-0.5 text-[9px] font-black text-white">あなたの利用</span> : null}</p><p className="truncate text-[10px] text-slate-500">{trip.employee.name} ・ <span className={cn(overdue && "font-black text-rose-700")}>{formatTime(trip.plannedEnd)}{overdue ? " 超過" : "まで"}</span></p></div>
          <GripVertical aria-hidden className="size-4 shrink-0 text-slate-300" />
        </button></li>;
      })}</ul>}
      {offSite.length ? <section aria-label="外出中（車検）"><div className="flex items-center justify-between border-y border-amber-100 bg-amber-50/70 px-3 py-1.5"><h3 className="text-xs font-black text-amber-900">外出中（車検）</h3><span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-800">{offSite.length}台</span></div><ul className="divide-y divide-slate-100">{offSite.map(({ maintenance, vehicle, spotCode }) => {
        const overdue = !!maintenance.plannedEnd && new Date(maintenance.plannedEnd).getTime() < now;
        return <li key={maintenance.id}><button type="button" title={`${vehicle.name}が戻ったら登録`} onClick={() => onSelectOffSite(vehicle)} className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-amber-50/60">
          <Wrench className="size-4 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1"><p className="truncate text-xs font-black">{vehicle.name}</p><p className="truncate text-[10px] text-slate-500"><span className={cn(overdue && "font-black text-rose-700")}>{maintenance.plannedEnd ? `${formatMaintenanceTime(maintenance.plannedEnd)}${overdue ? " 予定超過" : " 戻り予定"}` : "戻り予定 未定"}</span>{spotCode ? ` ・ ${spotCode}確保` : ""}</p>{maintenance.note ? <p className="truncate text-[10px] text-slate-400">{maintenance.note}</p> : null}</div>
          <span className="shrink-0 rounded-lg border border-emerald-200 px-2 py-1 text-[10px] font-black text-emerald-700">戻った</span>
        </button></li>;
      })}</ul></section> : null}
      {unplaced.length ? <section id="unplaced-vehicles" aria-label="位置未設定"><div className="flex items-center gap-2 border-y border-slate-200 bg-slate-50 px-3 py-1.5"><h3 className="text-xs font-black text-slate-700">位置未設定</h3><span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-black text-slate-700">{unplaced.length}台</span><span className="ml-auto text-[10px] font-bold text-slate-400">タップで区画を選ぶ</span></div><ul className="divide-y divide-slate-100">{unplaced.map((vehicle) => {
        const placing = vehicle.id === placingVehicleId;
        // 長い車名も2行まで出す。利用開始は小さなアイコンにして、行全体を「置く」操作にする。
        return <li key={vehicle.id} className={cn("flex items-center gap-1 pr-2 transition", placing && "bg-blue-50 ring-2 ring-inset ring-blue-300")}><button type="button" draggable aria-pressed={placing} title={`${vehicle.name}を置く区画を選ぶ（空き区画へドラッグも可）`} onClick={() => onPlace(vehicle)} onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", vehicle.name); onPlace(vehicle); }} className="flex min-w-0 flex-1 cursor-grab items-center gap-2 py-2 pl-3 text-left hover:bg-slate-50 active:cursor-grabbing">
          <CarFront className="size-4 shrink-0" style={{ color: vehicle.color }} />
          <div className="min-w-0 flex-1"><p className="line-clamp-2 break-words text-xs font-black leading-snug">{vehicle.name}</p>{placing ? <p className="text-[10px] font-black text-blue-700">置く区画をタップ</p> : <p className="truncate text-[10px] text-slate-500">{vehicle.code} ・ {vehicle.plateNumber}</p>}</div>
        </button><button type="button" title={`${vehicle.name}の利用を開始`} aria-label={`${vehicle.name}の利用を開始`} onClick={() => onStart(vehicle)} className="grid size-8 shrink-0 place-items-center rounded-lg text-blue-600 hover:bg-blue-50"><Play className="size-4 fill-current" /></button></li>;
      })}</ul></section> : null}
      </div>
    </div>
  </Card>;
}

// これからの予約を日付ごとに1件1行で並べる。利用中は右の「利用中」、完了は履歴で見る。
function TimelineList({ trips, openEdit, mode, onChange, timelineDate, timelineDays, setTimelineDate, setTimelineDays }: { trips: Trip[]; openEdit: (trip: Trip) => void; mode: "chart" | "list"; onChange: (mode: "chart" | "list") => void; timelineDate: Date; timelineDays: 1 | 3; setTimelineDate: React.Dispatch<React.SetStateAction<Date>>; setTimelineDays: React.Dispatch<React.SetStateAction<1 | 3>> }) {
  const now = new Date();
  const today = tokyoDayStart(now).getTime();
  const reservations = trips.filter((trip) => trip.status === "RESERVED" && new Date(trip.plannedEnd).getTime() > now.getTime()).sort((left, right) => left.plannedStart.localeCompare(right.plannedStart));
  const groups = new Map<number, Trip[]>();
  for (const trip of reservations) { const day = tokyoDayStart(new Date(trip.plannedStart)).getTime(); groups.set(day, [...(groups.get(day) ?? []), trip]); }
  const dayLabel = (day: number) => day === today ? "今日" : day === today + 86_400_000 ? "明日" : null;
  return <Card className="overflow-hidden"><TimelinePanelHeader mode={mode} onChange={onChange} /><TimelineDateNav timelineDate={timelineDate} timelineDays={timelineDays} setTimelineDate={setTimelineDate} setTimelineDays={setTimelineDays} />
    {reservations.length === 0 ? <div className="p-5"><Empty label="この期間の予約はありません" /></div> : [...groups].map(([day, items]) => <section key={day}>
      <h3 className="sticky top-0 flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-1.5 text-xs font-black text-slate-700">{dayLabel(day) ? <span className="text-blue-700">{dayLabel(day)}</span> : null}{jpShortDate.format(new Date(day))}<span className="ml-auto font-bold text-slate-400">{items.length}件</span></h3>
      <ul className="divide-y divide-slate-100">{items.map((trip) => {
        const sameDay = tokyoDayStart(new Date(trip.plannedEnd)).getTime() === day;
        return <li key={trip.id}><button type="button" onClick={() => openEdit(trip)} className="flex w-full items-center gap-3 px-4 py-2 text-left transition hover:bg-violet-50/50">
          <span className="w-28 shrink-0 text-xs font-bold tabular-nums text-slate-700">{formatTime(trip.plannedStart)}–{sameDay ? formatTime(trip.plannedEnd) : formatDateTime(trip.plannedEnd)}</span>
          <CarFront className="size-4 shrink-0" style={{ color: trip.vehicle.color }} />
          <span className="min-w-0 flex-1 truncate text-sm"><b className="font-black">{trip.vehicle.name}</b><span className="ml-2 text-xs text-slate-500">{trip.employee.name}</span></span>
          <ChevronRight className="size-4 shrink-0 text-slate-300" />
        </button></li>;
      })}</ul>
    </section>)}
  </Card>;
}

function SettingsNavigation({ view }: { view: "settingsEmployees" | "settingsDepartments" | "settingsVehicles" | "settingsSpots" | "settingsData" }) {
  return <nav aria-label="設定メニュー" className="inline-flex max-w-full overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm"><Link href="/settings/employees" className={cn("whitespace-nowrap rounded-lg px-5 py-2 text-sm font-bold transition", view === "settingsEmployees" ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50")}>社員登録</Link><Link href="/settings/departments" className={cn("whitespace-nowrap rounded-lg px-5 py-2 text-sm font-bold transition", view === "settingsDepartments" ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50")}>部署</Link><Link href="/settings/vehicles" className={cn("whitespace-nowrap rounded-lg px-5 py-2 text-sm font-bold transition", view === "settingsVehicles" ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50")}>車両登録</Link><Link href="/settings/spots" className={cn("whitespace-nowrap rounded-lg px-5 py-2 text-sm font-bold transition", view === "settingsSpots" ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50")}>駐車区画</Link><Link href="/settings/data" className={cn("whitespace-nowrap rounded-lg px-5 py-2 text-sm font-bold transition", view === "settingsData" ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50")}>データ保存・復元</Link></nav>;
}

function AdminToolsPanel() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return <Card className="overflow-hidden border-slate-200"><button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((current) => !current)} className="flex min-h-16 w-full items-center gap-3 px-4 text-left transition hover:bg-slate-50"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600"><Settings className="size-5" /></span><span className="mr-auto min-w-0"><span className="block text-sm font-black">管理・緊急時ツール</span><span className="block text-xs text-slate-500">障害時に使用する空白用紙の印刷</span></span>{open ? <ChevronUp className="size-5 text-slate-400" /> : <ChevronDown className="size-5 text-slate-400" />}</button>{open ? <div id={panelId} className="border-t border-slate-100 bg-amber-50/50 p-4"><div className="flex flex-wrap items-center gap-3"><div className="mr-auto min-w-64"><p className="flex items-center gap-2 font-black text-amber-950"><Printer className="size-5" />緊急時印刷</p><p className="mt-0.5 text-xs text-amber-800">障害時に手書きで運用できる、日付・予定・駐車位置が空欄のA4横用紙です。</p></div><Link href="/print/parking?print=1" target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-amber-300 bg-white px-4 text-sm font-bold text-amber-900 shadow-sm transition hover:bg-amber-100"><MapIcon className="size-4" />空白の配置図を印刷</Link><Link href="/print/timeline?print=1" target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800"><Clock3 className="size-4" />空白のタイムラインを印刷</Link></div></div> : null}</Card>;
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
  // 整備は予定・整備中・その日に終わった記録を帯で出す。整備中で戻り予定が未定なら、表示の終わりまで伸ばす。
  const maintenanceRange = (item: VehicleMaintenance) => {
    const start = new Date(item.actualStart ?? item.plannedStart).getTime();
    const plannedEnd = item.plannedEnd ? new Date(item.plannedEnd).getTime() : null;
    const end = item.actualEnd ? new Date(item.actualEnd).getTime() : item.status === "ACTIVE" ? Math.max(plannedEnd ?? timelineEnd.getTime(), now.getTime()) : plannedEnd ?? start;
    return { start, end, open: item.status === "ACTIVE" && plannedEnd === null };
  };
  const visibleMaintenancesByVehicle = new Map<string, VehicleMaintenance[]>();
  for (const item of data.maintenances) {
    const range = maintenanceRange(item);
    if (range.end <= timelineStart.getTime() || range.start >= timelineEnd.getTime()) continue;
    visibleMaintenancesByVehicle.set(item.vehicleId, [...(visibleMaintenancesByVehicle.get(item.vehicleId) ?? []), item]);
  }
  const activeKindByVehicle = new Map(data.maintenances.filter((item) => item.status === "ACTIVE").map((item) => [item.vehicleId, item.kind] as const));
  const parkingSpotByVehicle = new Map(data.spots.flatMap((spot) => spot.vehicle ? [[spot.vehicle.id, spot] as const] : []));
  const getMinute = (iso: string) => (new Date(iso).getTime() - timelineStart.getTime()) / 60_000;
  const todayStart = tokyoDayStart(now);
  const includesNow = now >= timelineStart && now < timelineEnd;
  const nowMinute = (now.getTime() - timelineStart.getTime()) / 60_000;
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
      await mutate({ action: "moveTrip", tripId: trip.id, version: trip.version, plannedStart: new Date(new Date(trip.plannedStart).getTime() + delta * 60_000).toISOString(), plannedEnd: new Date(new Date(trip.plannedEnd).getTime() + delta * 60_000).toISOString(), actorName }, `${trip.vehicle.name}の予約を${formatDateTime(new Date(new Date(trip.plannedStart).getTime() + delta * 60_000))}〜に変更しました`);
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

  return <><TimelineDateNav timelineDate={timelineDate} timelineDays={timelineDays} setTimelineDate={setTimelineDate} setTimelineDays={setTimelineDays}>{includesNow ? <button onClick={() => scrollToNow()} className="min-h-9 rounded-lg px-3 text-xs font-bold text-blue-700 hover:bg-blue-50">現在時刻へ</button> : null}</TimelineDateNav>
  <div ref={scrollArea} className="overflow-x-auto">
    <div className="min-w-max">
      <div className="sticky top-0 z-10 ml-32 bg-white" style={{ width: timelineWidth }}><div className="flex h-7 border-b border-slate-200">{days.map((day) => { const isToday = day.getTime() === todayStart.getTime(); return <div key={day.toISOString()} className={cn("border-l px-2 py-1 text-xs font-black", isToday ? "border-blue-400 bg-blue-50 text-blue-700" : "border-slate-300 bg-slate-50 text-slate-600")} style={{ width: (timelineDays === 1 ? timelineMinutes : MINUTES_PER_DAY) * pxPerMinute }}>{isToday ? "今日 " : ""}{jpShortDate.format(day)}</div>; })}</div><div className="relative h-7 border-b border-slate-100">{timeTicks.map((minute) => { const isHour = minute % 60 === 0; const isEnd = minute === timelineMinutes; const displayMinute = minute + (timelineDays === 1 ? DAY_VIEW_START_MINUTE : 0); return <span key={minute} className={cn("absolute inset-y-0 border-l", isHour ? "border-slate-300" : "border-slate-200")} style={{ left: minute * pxPerMinute }}>{isHour && !isEnd ? <span className="absolute left-1 top-1 whitespace-nowrap text-[9px] font-bold text-slate-500">{Math.floor(displayMinute / 60) % 24}:00</span> : null}</span>; })}{includesNow ? <span className="absolute inset-y-0 z-20 w-0.5 bg-rose-500" style={{ left: nowMinute * pxPerMinute }}><i className="absolute -left-1 top-0 size-2.5 rounded-full bg-rose-500" /></span> : null}</div></div>
      {data.vehicles.map((vehicle) => {
        const trips = visibleTripsByVehicle.get(vehicle.id) ?? [];
        const isHighlightedVehicle = trips.some((trip) => trip.id === highlightTripId);
        const parkingSpot = parkingSpotByVehicle.get(vehicle.id);
        const locationLabel = vehicle.status === "IN_USE" ? "利用中" : vehicle.status === "MAINTENANCE" ? MAINTENANCE_KIND_SHORT_LABELS[activeKindByVehicle.get(vehicle.id) ?? "ON_SITE"] : parkingSpot ? formatSpotLabel(parkingSpot) : "位置未設定";
        return <div ref={isHighlightedVehicle ? highlightedRow : undefined} key={vehicle.id} className={cn("flex h-[62px] border-b border-slate-100 [content-visibility:auto] [contain-intrinsic-size:62px] last:border-0", isHighlightedVehicle && "bg-amber-50 ring-2 ring-inset ring-amber-300")}>
          <button onClick={() => vehicle.active && vehicle.status === "AVAILABLE" && openStart(vehicle)} className={cn("sticky left-0 z-20 flex w-32 shrink-0 items-center gap-2 border-r border-slate-200 bg-white px-3 text-left hover:bg-slate-50", isHighlightedVehicle && "bg-amber-100", !vehicle.active && "opacity-50")}>
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: vehicle.color }} /><span className="min-w-0 flex-1"><span className="flex min-w-0 items-center gap-1"><b className="min-w-0 flex-1 truncate text-xs">{vehicle.name}</b>{isHighlightedVehicle ? <small className="shrink-0 rounded bg-amber-500 px-1 py-0.5 text-[8px] font-black text-white">登録</small> : null}</span><small title={`${formatPlateShort(vehicle.plateNumber)} ・ ${locationLabel}`} className={cn("block truncate text-[9px] font-bold", vehicle.status === "IN_USE" ? "text-blue-600" : vehicle.status === "MAINTENANCE" ? "text-amber-700" : parkingSpot ? "text-emerald-600" : "text-slate-500")}>{formatPlateShort(vehicle.plateNumber)} ・ {locationLabel}</small></span>
          </button>
          <div className="relative" style={{ width: timelineWidth, ...rowGridStyle }}>
            {includesNow ? <span className="pointer-events-none absolute inset-y-0 z-[1] w-0.5 bg-rose-400/70" style={{ left: nowMinute * pxPerMinute }} /> : null}
            {(visibleMaintenancesByVehicle.get(vehicle.id) ?? []).map((item) => {
              const range = maintenanceRange(item);
              const start = (range.start - timelineStart.getTime()) / 60_000;
              const end = (range.end - timelineStart.getTime()) / 60_000;
              const visibleStart = Math.max(0, start);
              const visibleDuration = Math.max(15, Math.min(timelineMinutes, end) - visibleStart);
              const label = item.status === "SCHEDULED" ? `${MAINTENANCE_KIND_SHORT_LABELS[item.kind]}の予定` : item.status === "COMPLETED" ? `${MAINTENANCE_KIND_SHORT_LABELS[item.kind]}（済）` : MAINTENANCE_KIND_SHORT_LABELS[item.kind];
              const sameDay = tokyoDayStart(new Date(range.start)).getTime() === tokyoDayStart(new Date(range.end)).getTime();
              const period = `${formatTime(new Date(range.start))}～${range.open ? "戻り未定" : sameDay ? formatTime(new Date(range.end)) : formatDateTime(new Date(range.end))}`;
              return <div key={item.id} title={`${label} ${formatDateTime(new Date(range.start))}–${range.open ? "戻り未定" : formatDateTime(new Date(range.end))}${item.note ? `\n${item.note}` : ""}`} className={cn("pointer-events-auto absolute top-2 z-[1] h-11 overflow-hidden rounded-xl border-2 px-3 text-left", item.status === "COMPLETED" ? "border-slate-300 bg-slate-100 text-slate-500" : "border-amber-400 text-amber-900", item.status === "SCHEDULED" && "border-dashed")} style={{ left: visibleStart * pxPerMinute, width: visibleDuration * pxPerMinute, ...(item.status === "COMPLETED" ? {} : { backgroundImage: "repeating-linear-gradient(135deg, #fef3c7 0 8px, #fde68a 8px 16px)" }) }}>
                <span className="flex items-center gap-1 truncate text-xs font-black"><Wrench className="size-3 shrink-0" />{start < 0 ? "◀ " : ""}{label}{end > timelineMinutes ? " ▶" : ""}</span><span className="block truncate text-[10px] opacity-80">{period}{item.note ? ` ・ ${item.note}` : ""}</span>
              </div>;
            })}
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
    {vehicle.hasEtc ? <span className={cn("rounded bg-sky-100 font-black text-sky-700", compact ? "px-1 text-[6px] leading-[9px] @2xl:text-[7px]" : "px-1.5 py-0.5 text-[10px]")}>ETC</span> : null}
    {vehicle.hasNavigation ? <span className={cn("rounded bg-violet-100 font-black text-violet-700", compact ? "px-1 text-[6px] leading-[9px] @2xl:text-[7px]" : "px-1.5 py-0.5 text-[10px]")}>ナビ</span> : null}
  </span>;
}

function ParkingMap({ data, trips, changedVehicleIds, mutate, openStart, openReturn, openFuel, openEdit, openEnd, actorName, currentEmployeeId, returnRequest }: { data: DashboardData; trips: Trip[]; changedVehicleIds: string[]; mutate: (body: object, success: string) => Promise<boolean>; openStart: (vehicle?: Vehicle) => void; openReturn: (spot: ParkingSpot) => void; openFuel: (vehicle: Vehicle) => void; openEdit: (trip: Trip) => void; openEnd: (trip: Trip, spotId?: string, changeSpot?: () => void) => void; actorName: string; currentEmployeeId: string | null; returnRequest: { tripId: string; nonce: number } | null }) {
  // 車両移動モードでドラッグ中、またはタップで選んだ移動元の車両。
  const [movingVehicleId, setMovingVehicleId] = useState<string | null>(null);
  // 位置未設定の車両も置けるよう、区画ではなく車両一覧から探す。
  const movingVehicle = movingVehicleId ? data.vehicles.find((vehicle) => vehicle.id === movingVehicleId && vehicle.active && vehicle.status === "AVAILABLE") ?? null : null;
  const unplacedVehicles = data.vehicles.filter((vehicle) => vehicle.active && vehicle.status === "AVAILABLE" && !vehicle.parkingSpotId);
  // 詳細欄の「位置変更」で車を選んでいる間だけ、車のドラッグと空き区画のタップで移動できる。
  const moveMode = movingVehicle !== null;
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const selectedSpot = selectedVehicleId ? data.spots.find((spot) => spot.vehicle?.id === selectedVehicleId) : undefined;
  const selectedVehicle = selectedSpot?.vehicle ?? null;
  // 選んだ時点の版を覚えておき、位置変更・残量変更などで車両が更新されたら詳細を閉じる。
  const selectedVersion = useRef<number | null>(null);
  const selectVehicle = (vehicle: Vehicle | null) => { selectedVersion.current = vehicle?.version ?? null; setSelectedVehicleId(vehicle?.id ?? null); if (vehicle) { setSelectedTripId(null); setReturningTripId(null); } };
  // 利用中の車両の詳細。駐車中の車両の詳細とは同時に開かない。
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const selectedTrip = selectedTripId ? trips.find((trip) => trip.id === selectedTripId) ?? null : null;
  // 返却する利用中の車両。一覧からドラッグ中、または詳細の「返却」で選んだ車両。
  const [returningTripId, setReturningTripId] = useState<string | null>(null);
  const returningTrip = returningTripId ? trips.find((trip) => trip.id === returningTripId) ?? null : null;

  useEffect(() => {
    if (selectedVehicleId && selectedVehicle?.version !== selectedVersion.current) setSelectedVehicleId(null);
  }, [selectedVehicleId, selectedVehicle?.version]);
  const startMove = (vehicle: Vehicle) => { setSelectedVehicleId(null); setSelectedTripId(null); setReturningTripId(null); setMovingVehicleId(vehicle.id); };
  const selectTrip = (trip: Trip) => { setSelectedVehicleId(null); setMovingVehicleId(null); setReturningTripId(null); setSelectedTripId((current) => current === trip.id ? null : trip.id); };
  const startReturn = (trip: Trip) => { setSelectedVehicleId(null); setSelectedTripId(null); setMovingVehicleId(null); setReturningTripId(trip.id); };
  const wavingVehicleIds = useFuelChangeWave(data.spots);
  const canDropOn = (spot: ParkingSpot) => !!movingVehicle && !spot.vehicle && canUseSpot(movingVehicle, spot);
  const moveTo = (spot: ParkingSpot) => {
    if (!movingVehicle || !canDropOn(spot)) return;
    setMovingVehicleId(null);
    void mutate({ action: "moveVehicle", vehicleId: movingVehicle.id, version: movingVehicle.version, spotId: spot.id, actorName }, movingVehicle.parkingSpotId ? `${formatSpotLabel(spot)}へ移動しました` : `${movingVehicle.name}を${formatSpotLabel(spot)}に置きました`);
  };
  // 返却先の区画を決めたら、燃料残量を入力する返却画面を開く。
  const canReturnTo = (spot: ParkingSpot) => !!returningTrip && !spot.vehicle && canUseSpot(returningTrip.vehicle, spot);
  const returnTo = (spot: ParkingSpot) => {
    if (!returningTrip || !canReturnTo(spot)) return;
    setReturningTripId(null);
    openEnd(returningTrip, spot.id, () => startReturn(returningTrip));
  };
  const isTarget = (spot: ParkingSpot) => canDropOn(spot) || canReturnTo(spot);
  const returnableCount = returningTrip ? data.spots.filter(canReturnTo).length : 0;
  // 車両タグをかざして返却するときも、ドラッグや「返却」と同じく配置図で返却先を選ぶ。
  useEffect(() => {
    if (!returnRequest) return;
    const trip = trips.find((item) => item.id === returnRequest.tripId);
    if (trip) startReturn(trip);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- かざすたびに1回だけ始める。
  }, [returnRequest?.nonce]);
  const pickingVehicle = movingVehicle ?? returningTrip?.vehicle ?? null;
  // 車検・修理で外出中の車両。区画は確保したまま、右の一覧にも出す。
  const offSiteMaintenances = data.maintenances.filter((item) => item.status === "ACTIVE" && item.kind === "OFF_SITE");
  const offSiteVehicleIds = new Set(offSiteMaintenances.map((item) => item.vehicleId));
  const selectedMaintenance = selectedVehicle?.status === "MAINTENANCE" ? activeMaintenanceOf(data, selectedVehicle.id) : null;
  const [maintenanceVehicleId, setMaintenanceVehicleId] = useState<string | null>(null);
  const maintenanceVehicle = maintenanceVehicleId ? data.vehicles.find((vehicle) => vehicle.id === maintenanceVehicleId) ?? null : null;
  const offSiteEntries = offSiteMaintenances.flatMap((item) => { const vehicle = data.vehicles.find((candidate) => candidate.id === item.vehicleId); const spot = data.spots.find((candidate) => candidate.vehicle?.id === item.vehicleId); return vehicle ? [{ maintenance: item, vehicle, spotCode: spot?.code ?? null }] : []; });
  // タイムラインの「駐車場で返却」から来たときは、その車の返却先選びから始める。
  useEffect(() => {
    const tripId = new URLSearchParams(window.location.search).get("returnTrip");
    if (!tripId) return;
    const trip = trips.find((item) => item.id === tripId);
    if (trip) startReturn(trip);
    window.history.replaceState({}, "", "/");
  }, [trips]);
  // 車両一覧の「配置図で置く」から来たときは、その車の置き場所選びから始める。
  useEffect(() => {
    const vehicleId = new URLSearchParams(window.location.search).get("placeVehicle");
    if (!vehicleId) return;
    const vehicle = data.vehicles.find((item) => item.id === vehicleId && item.active && item.status === "AVAILABLE");
    if (vehicle) startMove(vehicle);
    window.history.replaceState({}, "", "/");
  }, [data.vehicles]);
  return <><Card className="overflow-hidden">
    <div className="p-3 md:p-4">
      <div className="@container relative mx-auto aspect-[950/525] max-w-[1180px] overflow-hidden rounded-xl border border-slate-200 bg-white" style={{ width: "min(100%, calc((100vh - 270px) * 1.81))" }}>
        <img src="/parking-layout.svg" alt="" className="pointer-events-none absolute inset-0 size-full select-none" draggable={false} />
        {data.spots.map((spot) => <div key={spot.id} onDragOver={(e) => { if (isTarget(spot)) e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); if (returningTrip) returnTo(spot); else moveTo(spot); }} className={cn("absolute grid place-items-center rounded-[4px] border-2 transition", parkingSpotClass(spot, !!spot.vehicle && offSiteVehicleIds.has(spot.vehicle.id)), isTarget(spot) && "border-dashed border-blue-400 bg-blue-50", canReturnTo(spot) && "spot-beckon", pickingVehicle && !spot.vehicle && !canUseSpot(pickingVehicle, spot) && "cursor-not-allowed opacity-60", (spot.vehicle?.id === selectedVehicleId || spot.vehicle?.id === movingVehicleId) && "z-20 ring-4 ring-blue-300", spot.vehicle && changedVehicleIds.includes(spot.vehicle.id) && "z-10 ring-4 ring-amber-300 animate-pulse")} style={{ left: `${spot.x}%`, top: `${spot.y}%`, width: `${spot.width}%`, height: `${spot.height}%`, ...(canReturnTo(spot) ? { "--beckon-delay": `${(spot.x / 100) * 0.9}s` } as CSSProperties : {}) }}>
          {spot.vehicle && spot.vehicle.fuelLevel !== null && !offSiteVehicleIds.has(spot.vehicle.id) ? <FuelFill level={spot.vehicle.fuelLevel} waving={wavingVehicleIds.includes(spot.vehicle.id)} /> : null}
          <span className="absolute left-1 top-0.5 z-[1] text-[9px] font-black text-slate-500">{spot.code}{spotRoleTag(spot) ? <small className={cn("ml-0.5 text-[7px]", spot.role !== "HOLDING" && "hidden @2xl:inline", spot.role === "TEMPORARY" && "text-slate-400")}>{spotRoleTag(spot)}</small> : null}</span>
          {spot.vehicle ? <div className="relative size-full">{moveMode ? <button type="button" draggable aria-pressed={spot.vehicle.id === movingVehicleId} title={`${spot.vehicle.name}を移動`} onClick={() => setMovingVehicleId((current) => current === spot.vehicle?.id ? null : spot.vehicle?.id ?? null)} onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; setMovingVehicleId(spot.vehicle?.id ?? null); }} className="grid size-full cursor-grab place-content-center overflow-hidden text-center active:cursor-grabbing">{vehicleTileContent(spot.vehicle, spot.orientation === "horizontal", offSiteVehicleIds.has(spot.vehicle.id))}<GripVertical aria-hidden className="pointer-events-none absolute right-0.5 top-0.5 size-3.5 text-slate-400" /></button> : <button type="button" aria-pressed={spot.vehicle.id === selectedVehicleId} title={`${spot.vehicle.name}の詳細を表示`} onClick={() => selectVehicle(spot.vehicle?.id === selectedVehicleId ? null : spot.vehicle ?? null)} className={cn("grid size-full place-content-center overflow-hidden text-center", offSiteVehicleIds.has(spot.vehicle.id) && "opacity-60")}>{vehicleTileContent(spot.vehicle, spot.orientation === "horizontal", offSiteVehicleIds.has(spot.vehicle.id))}</button>}{spot.vehicle.fuelLevel !== null && !offSiteVehicleIds.has(spot.vehicle.id) ? <span className={cn("pointer-events-none absolute bottom-0.5 right-1 text-[7px] font-black leading-none @2xl:text-[8px]", isLowFuel(spot.vehicle.fuelLevel) ? "text-amber-800" : "text-emerald-800")}>残量 {formatFuelLevel(spot.vehicle.fuelLevel)}</span> : null}</div> : <button type="button" title={`${formatSpotLabel(spot)}へ返却`} onClick={() => { if (returningTrip) returnTo(spot); else if (moveMode) moveTo(spot); else openReturn(spot); }} className={cn("grid size-full place-content-center text-center transition", pickingVehicle ? !isTarget(spot) && "cursor-default" : "hover:bg-slate-100/70")}><span className="block text-[9px] font-bold leading-tight text-slate-500 @2xl:text-[11px] @5xl:text-[13px]"><MapPin className="mx-auto mb-0.5 size-3" />{spot.role === "HOLDING" ? "仮置き" : spot.role === "TEMPORARY" ? "一時" : spot.role === "DEDICATED" ? spot.dedicatedVehicleName ?? "専用" : "空き"}<span className="hidden @2xl:block">{spot.role === "HOLDING" ? "実在なし" : spot.role === "TEMPORARY" ? "駐車可" : spot.role === "DEDICATED" ? "専用" : "返却"}</span></span></button>}
        </div>)}
        {selectedVehicle && selectedSpot ? <div role="region" aria-label={`${selectedVehicle.name}の詳細`} className="absolute inset-x-2 bottom-2 z-30 mx-auto flex max-w-xl flex-wrap items-center gap-2 rounded-2xl border border-blue-200 bg-white/95 p-2.5 pr-4 shadow-2xl backdrop-blur"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-50"><CarFront className="size-5" style={{ color: selectedVehicle.color }} /></span><div className="mr-auto min-w-28 flex-1"><div className="flex flex-wrap items-center gap-1.5"><b className="text-sm">{selectedVehicle.name}</b>{selectedVehicle.status === "MAINTENANCE" ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-800">{MAINTENANCE_KIND_SHORT_LABELS[selectedMaintenance?.kind ?? "ON_SITE"]}</span> : null}<VehicleEquipmentBadges vehicle={selectedVehicle} /></div><p className="text-[10px] font-bold text-slate-500">{selectedVehicle.plateNumber} ・ {selectedVehicle.code} ・ {selectedMaintenance?.kind === "OFF_SITE" ? "確保中の区画" : "駐車位置"} {selectedSpot.code}{selectedMaintenance ? ` ・ 戻り予定 ${selectedMaintenance.plannedEnd ? formatMaintenanceTime(selectedMaintenance.plannedEnd) : "未定"}` : selectedVehicle.fuelLevel !== null ? ` ・ 残量 ${formatFuelLevel(selectedVehicle.fuelLevel)}` : ""}</p>{selectedMaintenance?.note ? <p className="truncate text-[10px] text-slate-500">{selectedMaintenance.note}</p> : null}</div>{selectedVehicle.status === "MAINTENANCE" ? <Button className="min-h-9 bg-emerald-600 px-3 text-xs hover:bg-emerald-700" onClick={() => { setSelectedVehicleId(null); setMaintenanceVehicleId(selectedVehicle.id); }}><Wrench className="size-3.5" />{selectedMaintenance?.kind === "OFF_SITE" ? "戻った" : "整備解除"}</Button> : <><Button className="min-h-9 px-3 text-xs" disabled={selectedVehicle.status !== "AVAILABLE"} onClick={() => openStart(selectedVehicle)}><CarFront className="size-3.5" />利用開始</Button><Button variant="ghost" className="min-h-9 px-3 text-xs" onClick={() => startMove(selectedVehicle)}><MapPin className="size-3.5" />位置変更</Button><Button variant="ghost" className="min-h-9 px-3 text-xs" onClick={() => openFuel(selectedVehicle)}><Fuel className="size-3.5" />残量変更</Button></>}<button type="button" aria-label="車両詳細を閉じる" onClick={() => setSelectedVehicleId(null)} className="absolute -right-2.5 -top-2.5 grid size-8 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-md hover:bg-slate-100 hover:text-slate-800"><X className="size-4" /></button></div> : null}
        {selectedTrip ? <div role="region" aria-label={`${selectedTrip.vehicle.name}の利用状況`} className="absolute inset-x-2 bottom-2 z-30 mx-auto flex max-w-xl flex-wrap items-center gap-2 rounded-2xl border border-blue-200 bg-white/95 p-2.5 pr-4 shadow-2xl backdrop-blur"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-50"><CarFront className="size-5" style={{ color: selectedTrip.vehicle.color }} /></span><div className="mr-auto min-w-32 flex-1"><div className="flex flex-wrap items-center gap-1.5"><b className="text-sm">{selectedTrip.vehicle.name}</b><span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-black text-blue-700">利用中</span></div><p className="text-[10px] font-bold text-slate-500">{selectedTrip.employee.name} ・ <span className={cn(new Date(selectedTrip.plannedEnd).getTime() < Date.now() && "text-rose-700")}>{formatDateTime(selectedTrip.plannedEnd)}{new Date(selectedTrip.plannedEnd).getTime() < Date.now() ? " 超過" : " 返却予定"}</span></p></div><Button className="min-h-9 px-3 text-xs" onClick={() => startReturn(selectedTrip)}><LogOut className="size-3.5" />返却</Button><TripExtendButtons trip={selectedTrip} reservations={data.nextReservations} minutes={[15, 30, 60]} mutate={mutate} actorName={actorName} className="min-h-9 px-2 text-xs" /><Button variant="ghost" className="min-h-9 px-3 text-xs" onClick={() => openEdit(selectedTrip)}><Pencil className="size-3.5" />予定変更</Button><button type="button" aria-label="利用状況を閉じる" onClick={() => setSelectedTripId(null)} className="absolute -right-2.5 -top-2.5 grid size-8 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-md hover:bg-slate-100 hover:text-slate-800"><X className="size-4" /></button></div> : null}
      </div>
      {returningTrip ? <div role="status" className="mx-auto mt-2 flex max-w-md items-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 p-2"><LogOut className="size-4 shrink-0 text-blue-600" /><p className="mr-auto text-xs font-bold"><b>{returningTrip.vehicle.name}</b>{returnableCount > 0 ? <>を返却する区画をタップ（点滅中の空き{returnableCount}区画・ドラッグも可）</> : "を返却できる空き区画がありません"}</p><Button variant="ghost" className="min-h-8 shrink-0 whitespace-nowrap px-3 text-xs" onClick={() => setReturningTripId(null)}>やめる</Button></div> : null}
      {movingVehicle ? <div role="status" className="mx-auto mt-2 flex max-w-md items-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 p-2"><Move className="size-4 shrink-0 text-blue-600" /><p className="mr-auto text-xs font-bold"><b>{movingVehicle.name}</b>{movingVehicle.parkingSpotId ? "の移動先" : "を置く区画"}をタップ（ドラッグも可）</p><Button variant="ghost" className="min-h-8 shrink-0 whitespace-nowrap px-3 text-xs" onClick={() => setMovingVehicleId(null)}>やめる</Button></div> : null}
    </div>
  </Card>
  <ActiveVehicleSidebar trips={trips} mineEmployeeId={currentEmployeeId} offSite={offSiteEntries} unplaced={unplacedVehicles} selectedTripId={selectedTripId} returningTripId={returningTripId} placingVehicleId={movingVehicle && !movingVehicle.parkingSpotId ? movingVehicle.id : null} onSelect={selectTrip} onSelectOffSite={(vehicle) => { setSelectedTripId(null); setMaintenanceVehicleId(vehicle.id); }} onPlace={(vehicle) => { if (movingVehicleId === vehicle.id) setMovingVehicleId(null); else startMove(vehicle); }} onStart={(vehicle) => { setMovingVehicleId(null); openStart(vehicle); }} onDragStart={startReturn} onDragEnd={() => setReturningTripId(null)} />
  {maintenanceVehicle ? <MaintenanceDialog vehicle={maintenanceVehicle} data={data} mutate={mutate} onClose={() => setMaintenanceVehicleId(null)} /> : null}
  </>;
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
// 利用開始の手順。今やる手順は青、済んだ手順は緑、まだ先の手順は灰色で示す。
function StartStep({ step, label, state, children }: { step: 1 | 2 | 3; label: string; state: "done" | "active" | "upcoming"; children: React.ReactNode }) {
  return <section aria-current={state === "active" ? "step" : undefined} className={cn("flex flex-col gap-3 rounded-2xl border p-4 transition", state === "done" ? "border-emerald-200 bg-emerald-50/60" : state === "active" ? "border-blue-400 bg-white ring-4 ring-blue-50" : "border-dashed border-slate-300 bg-slate-50/60")}>
    <h3 className={cn("flex items-center gap-2 text-sm font-black", state === "done" ? "text-emerald-800" : state === "active" ? "text-blue-700" : "text-slate-400")}><span className={cn("grid size-6 shrink-0 place-items-center rounded-full text-xs", state === "done" ? "bg-emerald-600 text-white" : state === "active" ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-500")}>{state === "done" ? <Check className="size-3.5" /> : step}</span>{label}</h3>
    <div className={cn("flex flex-1 flex-col gap-3", state === "upcoming" && "opacity-60")}>{children}</div>
  </section>;
}
function StartDialog({ employees, vehicles, trips, initialEmployee, initialVehicleId, submitting, onClose, onSubmit }: { employees: Employee[]; vehicles: Vehicle[]; trips: Trip[]; initialEmployee: Employee | null; initialVehicleId: string; submitting: boolean; onClose: () => void; onSubmit: (v: { employeeId: string; employeeName: string; vehicleId: string; minutes: number; plannedStart: string | null }) => void }) {
  const [employeeId, setEmployeeId] = useState(initialEmployee?.id ?? "");
  const [nfcUid, setNfcUid] = useState(initialEmployee?.nfcUid ?? "");
  const [nfcError, setNfcError] = useState("");
  const [employeeScanEnabled, setEmployeeScanEnabled] = useState(!initialEmployee);
  const [employeeScanTimedOut, setEmployeeScanTimedOut] = useState(false);
  const vehicleId = initialVehicleId;
  const [totalMinutes, setTotalMinutes] = useState(60);
  const [untilLunchEnd, setUntilLunchEnd] = useState(false);
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
  // 昼休み中は13:00返却をワンタップで選べる。最短15分を切る12:45以降は出さない。
  const lunchMinutes = Math.ceil((new Date(now).setHours(13, 0, 0, 0) - now.getTime()) / 60_000);
  const lunchAvailable = now.getHours() === 12 && lunchMinutes >= 15;
  const lunchActive = untilLunchEnd && startMode === "now" && lunchAvailable;
  const durationMinutes = lunchActive ? lunchMinutes : totalMinutes;
  const plannedEnd = startMode === "now" ? new Date(now.getTime() + durationMinutes * 60_000) : scheduledEnd;
  const submissionMinutes = startMode === "now" ? durationMinutes : Math.round((plannedEnd.getTime() - effectiveStart.getTime()) / 60_000);
  const durationLabel = durationMinutes < 60 ? `${durationMinutes}分` : `${Math.floor(durationMinutes / 60)}時間${durationMinutes % 60 ? `${durationMinutes % 60}分` : ""}`;
  const changeDuration = (amount: number) => { setUntilLunchEnd(false); setTotalMinutes(Math.max(15, Math.min(10_080, durationMinutes + amount))); };
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
  const identifyEmployee = async (uid: string) => {
    const normalized = normalizeNfcUid(uid);
    try {
      const result = await resolveNfcUid(normalized);
      const person = result?.kind === "employee" ? employees.find((item) => item.id === result.id) : undefined;
      if (!person) { playNfcSound("error"); setEmployeeId(""); setNfcError("登録されていない社員タグです"); return; }
      playNfcSound("success");
      setEmployeeId(person.id); setNfcUid(normalized); setNfcError(""); setEmployeeScanEnabled(false); setEmployeeScanTimedOut(false);
    } catch { playNfcSound("error"); setEmployeeId(""); setNfcError("NFCタグを確認できませんでした。接続状態を確認してください"); }
  };
  const bridgeStatus = useNfcBridge(!selectedEmployee && employeeScanEnabled, identifyEmployee);
  useNfcScanTimeout(!selectedEmployee && employeeScanEnabled, () => {
    setEmployeeScanEnabled(false);
    setEmployeeScanTimedOut(true);
  });
  return <DialogShell wide busy={submitting} title={activeReservation ? "予約した車両を利用開始" : "利用開始を登録"} subtitle={activeReservation ? "予約内容を確認し、実際の利用開始を登録してください" : !selectedEmployee ? "手順 2/3 ・ 社員証をかざしてください" : startMode === "scheduled" ? "手順 3/3 ・ 内容を確認して予約してください" : "手順 3/3 ・ 内容を確認して利用開始してください"} onClose={onClose}><form className="start-dialog grid gap-5 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (selectedEmployee && (activeReservation || scheduledValid)) onSubmit({ employeeId, employeeName: selectedEmployee.name, vehicleId, minutes: activeReservationMinutes, plannedStart: activeReservation ? null : startMode === "scheduled" ? effectiveStart.toISOString() : null }); }}>
    <div className="flex flex-col gap-4">
      <StartStep step={1} label="車両確認" state={selectedVehicle ? "done" : "active"}>{selectedVehicle ? <div className="flex items-center gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white"><CarFront className="size-6" style={{ color: selectedVehicle.color }} /></span><div className="min-w-0 flex-1"><p className="truncate text-base font-black text-slate-900">{selectedVehicle.name}</p><p className="truncate text-xs text-emerald-800">{selectedVehicle.plateNumber}</p><VehicleEquipmentBadges vehicle={selectedVehicle} /></div></div> : <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-700">車両を確認できません。画面を閉じて選び直してください。</p>}<p className="text-[10px] text-slate-500">変更する場合は画面を閉じ、利用する車両を選び直してください。</p></StartStep>
      <StartStep step={2} label="利用者確認" state={selectedEmployee ? "done" : "active"}>{selectedEmployee ? <div role="status" className="flex items-center gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white text-emerald-700"><UserRound className="size-6" /></span><div className="min-w-0 flex-1"><p className="truncate text-base font-black text-slate-900">{selectedEmployee.name}</p><p className="truncate text-xs text-emerald-800">社員番号 {selectedEmployee.code} ・ {selectedEmployee.department}</p></div><button type="button" onClick={() => { setEmployeeId(""); setNfcUid(""); setEmployeeScanEnabled(true); setEmployeeScanTimedOut(false); }} className="min-h-11 shrink-0 whitespace-nowrap rounded-xl px-3 text-xs font-bold text-emerald-800 hover:bg-emerald-100">選び直す</button></div> : <div className={cn("rounded-xl border p-4", employeeScanTimedOut ? "border-amber-200 bg-amber-50" : "border-blue-200 bg-blue-50")}><div className={cn("flex min-h-24 items-center gap-3", employeeScanTimedOut ? "text-amber-800" : "text-blue-700")}><span className="grid size-14 shrink-0 place-items-center rounded-full bg-white"><Nfc className={cn("size-8", employeeScanEnabled && "animate-pulse")} /></span><div><p className="text-base font-black">{employeeScanTimedOut ? "社員証を読み取れませんでした" : "社員証をかざしてください"}</p><p role="status" aria-live="polite" className={cn("mt-1 text-xs", employeeScanTimedOut ? "font-bold text-amber-700" : bridgeStatus === "ready" ? "font-bold text-emerald-700" : "text-blue-600")}>{employeeScanTimedOut ? "15秒以内に読み取れませんでした。再試行または手動選択ができます。" : nfcBridgeStatusText(bridgeStatus)}</p></div></div>{employeeScanTimedOut ? null : <NfcBridgeHelp status={bridgeStatus} className="mt-3" />}{nfcError ? <p role="alert" className="mt-3 rounded-xl bg-white p-3 text-xs font-bold text-rose-600">{nfcError}</p> : null}{employeeScanTimedOut ? <button type="button" onClick={() => { setEmployeeScanEnabled(true); setEmployeeScanTimedOut(false); setNfcError(""); }} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 text-xs font-bold text-white hover:bg-blue-700"><Nfc className="size-4" />NFC読取を再試行</button> : null}<details className={cn("mt-3 border-t pt-3", employeeScanTimedOut ? "border-amber-200" : "border-blue-200")}><summary className="flex min-h-12 cursor-pointer list-none items-center justify-center rounded-xl text-xs font-bold text-slate-600 hover:bg-white/70">NFCを使わず社員を選択</summary><div className="mt-3 space-y-3"><select aria-label="社員を選択" className={field} value="" onChange={(event) => { const person = employees.find((item) => item.id === event.target.value); if (person) { setEmployeeId(person.id); setNfcUid(person.nfcUid); setNfcError(""); setEmployeeScanEnabled(false); setEmployeeScanTimedOut(false); } }}><option value="">社員番号から選択してください</option>{orderedEmployees.map((person) => <option key={person.id} value={person.id}>{person.code}　{person.name}（{person.department}）</option>)}</select><div className="flex gap-2"><input aria-label="NFC UIDを手入力" className={field} value={nfcUid} onChange={(event) => setNfcUid(event.target.value)} onBlur={() => setNfcUid(normalizeNfcUid(nfcUid))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); identifyEmployee(nfcUid); } }} placeholder="NFC UIDを手入力" /><Button type="button" className="min-h-12 shrink-0 whitespace-nowrap px-4" onClick={() => identifyEmployee(nfcUid)}>認識</Button></div></div></details></div>}</StartStep>
    </div>
    {activeReservation ? <StartStep step={3} label="予約内容の確認" state="active"><p className="text-xs text-slate-600">時間の再入力は不要です。現在時刻を実際の開始として記録します。</p><div className="rounded-xl border border-violet-200 bg-white p-4"><p className="text-xs font-bold text-violet-600">利用予定</p><p className="mt-1 text-xl font-black text-slate-900">{formatDateTime(activeReservation.plannedStart)} ～ {formatDateTime(activeReservation.plannedEnd)}</p><div className="mt-3 grid grid-cols-2 gap-3 border-t border-violet-100 pt-3 text-xs"><div><p className="text-slate-400">利用者</p><p className="mt-1 font-black">{activeReservation.employee.name}</p></div><div><p className="text-slate-400">車両</p><p className="mt-1 font-black">{activeReservation.vehicle.name}</p></div></div></div><p className="text-xs text-slate-500">利用開始後は車両が「利用中」になります。</p><Button type="submit" className="mt-auto min-h-14 w-full text-base" disabled={submitting || !selectedEmployee || !selectedVehicle}>{submitting ? <LoaderCircle className="size-5 animate-spin" /> : <CarFront className="size-5" />}{submitting ? "利用開始中…" : "予約した車両を利用開始"}</Button></StartStep> : <StartStep step={3} label="内容確認" state={selectedEmployee ? "active" : "upcoming"}>
      <div><p className="mb-2 text-xs font-bold text-slate-600">利用開始</p><div className="grid grid-cols-2 rounded-xl bg-slate-200/70 p-1"><button type="button" aria-pressed={startMode === "now"} onClick={() => setStartMode("now")} className={cn("min-h-11 rounded-lg text-sm font-black transition", startMode === "now" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500")}>今すぐ</button><button type="button" aria-pressed={startMode === "scheduled"} onClick={() => { setStartMode("scheduled"); setScheduledStart((current) => current < nextQuarterHour() ? nextQuarterHour() : current); }} className={cn("min-h-11 rounded-lg text-sm font-black transition", startMode === "scheduled" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500")}>時刻指定</button></div>{lunchAvailable ? <button type="button" aria-pressed={lunchActive} onClick={() => { setStartMode("now"); setUntilLunchEnd(true); }} className={cn("mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border text-sm font-black transition", lunchActive ? "border-blue-600 bg-blue-600 text-white shadow-sm" : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50")}><Utensils className="size-4" />昼休み 今から〜13:00</button> : null}</div>
      {startMode === "scheduled" ? <>
        <div><p className="mb-2 text-xs font-bold text-slate-600">予約の種類</p><div className="grid grid-cols-3 rounded-xl bg-slate-200/70 p-1">{([{ value: "timed", label: "時間指定" }, { value: "allDay", label: "終日" }, { value: "multiDay", label: "複数日" }] as const).map((kind) => <button type="button" key={kind.value} aria-pressed={scheduleKind === kind.value} onClick={() => { setScheduleKind(kind.value); if (kind.value === "allDay") setScheduledStart(nextAllDayStart()); if (kind.value === "multiDay") { const start = nextQuarterHour(); setMultiDayStart(start); setMultiDayEnd(new Date(start.getTime() + 24 * 60 * 60_000)); } }} className={cn("min-h-10 rounded-lg text-xs font-black transition", scheduleKind === kind.value ? "bg-white text-blue-700 shadow-sm" : "text-slate-500")}>{kind.label}</button>)}</div></div>
        {scheduleKind !== "multiDay" ? <div><p className="mb-2 text-xs font-bold text-slate-600">開始日</p><div className="grid grid-cols-2 gap-2"><button type="button" aria-pressed={scheduledDay === 0} onClick={() => setScheduledDay(0)} disabled={scheduleKind === "allDay" && nextAllDayStart().toDateString() !== new Date().toDateString()} className={cn("min-h-11 rounded-xl border text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-35", scheduledDay === 0 ? "border-blue-600 bg-blue-600 text-white shadow-sm" : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50")}>今日</button><button type="button" aria-pressed={scheduledDay === 1} onClick={() => setScheduledDay(1)} className={cn("min-h-11 rounded-xl border text-sm font-black transition", scheduledDay === 1 ? "border-blue-600 bg-blue-600 text-white shadow-sm" : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50")}>明日</button></div></div> : null}
        {scheduleKind === "timed" ? <div><p className="mb-2 text-xs font-bold text-slate-600">開始時刻</p><div className="grid grid-cols-[1fr_1.4fr_1fr] items-center gap-2"><button type="button" aria-label="開始を15分早める" onClick={() => changeScheduledStart(-15)} disabled={scheduledStart.getTime() <= nextQuarterHour().getTime()} className="min-h-11 rounded-xl border border-slate-200 bg-white text-xs font-black text-slate-700 hover:bg-slate-100 disabled:opacity-35">−15分</button><p aria-live="polite" className="text-center text-xl font-black text-slate-900">{formatTime(scheduledStart)}</p><button type="button" aria-label="開始を15分遅らせる" onClick={() => changeScheduledStart(15)} className="min-h-11 rounded-xl border border-slate-200 bg-white text-xs font-black text-slate-700 hover:bg-slate-100 disabled:opacity-35">＋15分</button></div></div> : null}
        {scheduleKind === "allDay" ? <div><p className="mb-2 text-xs font-bold text-slate-600">利用時間</p><p className="rounded-xl border border-slate-200 bg-white p-3 text-center text-lg font-black text-slate-900">6:00 ～ 22:00</p></div> : null}
        {scheduleKind === "multiDay" ? <div className="grid gap-2"><label className="text-xs font-bold text-slate-600">開始日時<input type="datetime-local" step={900} min={toLocalDateTimeInput(nextQuarterHour())} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-2 text-sm font-bold text-slate-900" value={toLocalDateTimeInput(multiDayStart)} onChange={(event) => { const value = new Date(event.target.value); if (!Number.isNaN(value.getTime())) { setMultiDayStart(value); if (multiDayEnd <= value) setMultiDayEnd(new Date(value.getTime() + 24 * 60 * 60_000)); } }} /></label><label className="text-xs font-bold text-slate-600">終了日時<input type="datetime-local" step={900} min={toLocalDateTimeInput(new Date(multiDayStart.getTime() + 15 * 60_000))} max={toLocalDateTimeInput(new Date(multiDayStart.getTime() + 7 * 24 * 60 * 60_000))} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-2 text-sm font-bold text-slate-900" value={toLocalDateTimeInput(multiDayEnd)} onChange={(event) => { const value = new Date(event.target.value); if (!Number.isNaN(value.getTime())) setMultiDayEnd(value); }} /></label><p className="text-center text-[10px] text-slate-500">連続した期間・最大7日間</p></div> : null}
      </> : null}
      {startMode === "now" || scheduleKind === "timed" ? <div><p className="mb-2 text-xs font-bold text-slate-600">利用予定時間</p><div className="grid grid-cols-4 gap-2">{[{ label: "1時間", value: 60 }, { label: "2時間", value: 120 }, { label: "3時間", value: 180 }, { label: "5時間", value: 300 }].map((preset) => <button type="button" key={preset.value} aria-pressed={!lunchActive && totalMinutes === preset.value} onClick={() => { setUntilLunchEnd(false); setTotalMinutes(preset.value); }} className={cn("min-h-11 rounded-xl border px-1 text-sm font-black transition", !lunchActive && totalMinutes === preset.value ? "border-blue-600 bg-blue-600 text-white shadow-sm" : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50")}>{preset.label}</button>)}</div><div className="mt-2 grid grid-cols-[1fr_1.4fr_1fr] items-center gap-2"><button type="button" aria-label="15分短くする" onClick={() => changeDuration(-15)} disabled={durationMinutes <= 15} className="min-h-11 rounded-xl border border-slate-200 bg-white text-xs font-black text-slate-700 hover:bg-slate-100 disabled:opacity-35">−15分</button><div className="text-center"><p className="text-[10px] font-bold text-slate-400">選択中</p><p aria-live="polite" className="text-base font-black text-slate-900">{durationLabel}</p></div><button type="button" aria-label="15分長くする" onClick={() => changeDuration(15)} className="min-h-11 rounded-xl border border-slate-200 bg-white text-xs font-black text-slate-700 hover:bg-slate-100">＋15分</button></div></div> : null}
      <div className={cn("rounded-xl border-2 p-3 text-center", startMode === "scheduled" ? "border-violet-200 bg-violet-50" : "border-slate-200 bg-slate-50")}><p className={cn("flex items-center justify-center gap-1.5 text-[10px] font-bold", startMode === "scheduled" ? "text-violet-700" : "text-slate-500")}>{startMode === "scheduled" ? <><span className="rounded-full bg-violet-600 px-2 py-0.5 font-black text-white">予約</span>利用予定</> : "返却予定"}</p><p className={cn("mt-0.5 text-xl font-black tracking-tight", startMode === "scheduled" ? "text-violet-900" : "text-slate-900")}>{formatTime(effectiveStart)} ～ {formatTime(plannedEnd)}</p><p className={cn("text-[10px]", startMode === "scheduled" ? "text-violet-700" : "text-slate-500")}>{formatDateTime(effectiveStart)} ～ {formatDateTime(plannedEnd)}</p>{startMode === "scheduled" ? <p className="mt-1 text-[10px] font-bold text-violet-700">開始から{RESERVATION_GRACE_MINUTES}分以内に利用開始されない場合は自動取消</p> : null}</div>
      <Button type="submit" className="min-h-14 w-full text-base" disabled={submitting || !selectedEmployee || !selectedVehicle || !scheduledValid}>{submitting ? <LoaderCircle className="size-5 animate-spin" /> : startMode === "scheduled" ? <Clock3 className="size-5" /> : <CarFront className="size-5" />}{submitting ? "登録しています…" : !selectedEmployee ? "先に社員証をかざしてください" : startMode === "scheduled" ? "この内容で予約" : "この内容で利用開始"}</Button>
    </StartStep>}
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
function ParkingReturnDialog({ spot, trips: allTrips, vehicles, submitting, onClose, onSubmit }: { spot: ParkingSpot; trips: Trip[]; vehicles: Vehicle[]; submitting: boolean; onClose: () => void; onSubmit: (trip: Trip, fuelLevel: number | null) => void }) {
  const [method, setMethod] = useState<"manual" | "nfc">("nfc");
  const [tripId, setTripId] = useState("");
  const [fuelChoice, setFuelChoice] = useState<{ tripId: string; level: number } | null>(null);
  const [nfcError, setNfcError] = useState("");
  const [fallbackNotice, setFallbackNotice] = useState("");
  const trips = allTrips.filter((trip) => canUseSpot(trip.vehicle, spot));
  const selected = trips.find((trip) => trip.id === tripId);
  const fuelLevel = selected ? fuelChoice?.tripId === selected.id ? fuelChoice.level : selected.vehicle.fuelLevel : null;
  const bridgeStatus = useNfcBridge(method === "nfc", async (uid) => {
    try {
      const result = await resolveNfcUid(uid);
      const vehicle = result?.kind === "vehicle" ? vehicles.find((item) => item.id === result.id) : undefined;
      const activeTrip = vehicle ? allTrips.find((item) => item.vehicleId === vehicle.id) : undefined;
      const trip = activeTrip ? trips.find((item) => item.id === activeTrip.id) : undefined;
      playNfcSound(trip ? "success" : "error");
      if (!vehicle) { setTripId(""); setNfcError("登録されていない車両タグです"); return; }
      if (!activeTrip) { setTripId(""); setNfcError(`${vehicle.name}は現在利用中ではありません`); return; }
      if (!trip) { setTripId(""); setNfcError(`${vehicle.name}は${formatSpotLabel(spot)}へ返却できません`); return; }
      setTripId(trip.id); setNfcError("");
    } catch { playNfcSound("error"); setTripId(""); setNfcError("NFCタグを確認できませんでした。接続状態を確認してください"); }
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
  return <DialogShell busy={submitting} title={`${formatSpotLabel(spot)} へ返却`} subtitle={spot.role === "CUSTOMER" ? "お客様用区画ですが、社用車も返却できます" : spot.role === "HOLDING" ? "実在する駐車区画ではありません。駐車場所を確定できない場合だけ使用してください" : spot.role === "TEMPORARY" ? "通常区画ではありませんが、一時的な返却先として利用できます" : spot.role === "DEDICATED" ? `${spot.dedicatedVehicleName ?? "指定した車両"}だけを返却できます` : "車両タグを読み取り、返却内容を確認してください"} onClose={onClose}><div className="space-y-4">
    <OperationProgress labels={["返却先", "車両読取", "内容確定"]} current={selected ? 3 : 2} />
    {trips.length === 0 ? <Empty label="現在利用中の車両はありません" /> : method === "manual" ? <div className="space-y-3">{fallbackNotice ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">{fallbackNotice}</p> : null}<Label text="返却する車両"><select className={field} value={tripId} onChange={(event) => setTripId(event.target.value)}><option value="">車両を選択してください</option>{trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.vehicle.name}　{trip.vehicle.plateNumber}（{trip.employee.name}）</option>)}</select></Label><button type="button" onClick={() => switchMethod("nfc")} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-700 hover:bg-blue-100"><Nfc className="size-4" />NFC読取を再試行</button></div> : <div className={cn("rounded-2xl border p-4 transition", selected ? "border-emerald-300 bg-emerald-50" : "border-blue-200 bg-blue-50")}><div className="text-center"><span className={cn("mx-auto grid size-14 place-items-center rounded-full", selected ? "bg-emerald-600 text-white" : "bg-white text-blue-600")} >{selected ? <Check className="size-7" /> : <Nfc className="size-8 animate-pulse" />}</span><p className={cn("mt-3 text-sm font-black", selected ? "text-emerald-800" : "text-blue-800")}>{selected ? "車両を読み取りました" : "車両のNFCタグをかざしてください"}</p><p className={cn("text-[11px]", bridgeStatus === "ready" ? "font-bold text-emerald-700" : "text-blue-500")}>{nfcBridgeStatusText(bridgeStatus)}</p>{nfcError ? <p role="alert" className="mt-3 rounded-xl bg-white p-3 text-xs font-bold text-rose-600">{nfcError}</p> : null}{selected ? null : <NfcBridgeHelp status={bridgeStatus} className="mt-3" />}</div>{process.env.NODE_ENV === "development" && !selected ? <div className="mt-4 grid gap-2 sm:grid-cols-2">{trips.map((trip) => <button type="button" key={trip.id} onClick={() => { setTripId(trip.id); setNfcError(""); }} className="rounded-xl border border-blue-100 bg-white p-3 text-left text-xs transition hover:border-blue-300"><b className="block">{trip.vehicle.name}</b><span className="text-slate-500">{trip.employee.name}</span></button>)}</div> : null}{!selected ? <button type="button" onClick={() => switchMethod("manual")} className="mt-4 min-h-9 w-full text-xs font-bold text-slate-500 underline decoration-slate-300 underline-offset-4">NFCを使わず手動で選択</button> : null}</div>}
    {selected ? <div className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm"><div className="flex items-start gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700"><CarFront className="size-6" /></span><div className="min-w-0 flex-1"><p className="text-[11px] font-bold text-emerald-700">返却内容を確認</p><p className="truncate text-base font-black">{selected.vehicle.name} <span className="text-slate-400">・ {formatPlateShort(selected.vehicle.plateNumber)}</span></p><p className="mt-1 text-xs text-slate-600">返却先：<b>{formatSpotLabel(spot)}</b>　利用者：{selected.employee.name}</p></div><button type="button" onClick={() => setTripId("")} className="shrink-0 text-xs font-bold text-slate-500">選び直す</button></div></div> : null}
    {selected ? <FuelLevelPicker value={fuelLevel} onChange={(level) => setFuelChoice({ tripId: selected.id, level })} /> : null}
    <Button className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={!selected || submitting} onClick={() => selected && onSubmit(selected, fuelLevel)}>{submitting ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}{submitting ? "返却登録中…" : "返却を完了して利用可能にする"}</Button>
    <p className="text-center text-[11px] text-slate-400">確認ボタンを押すまで返却は確定しません。</p>
  </div></DialogShell>;
}
// 返却の確認画面。配置図で区画を選んできた場合は結果だけを示し、「変更」で配置図の区画選びへ戻る。
function EndDialog({ trip, spots, initialSpotId = "", onChangeSpot, submitting, onClose, onSubmit }: { trip: Trip; spots: ParkingSpot[]; initialSpotId?: string; onChangeSpot?: () => void; submitting: boolean; onClose: () => void; onSubmit: (spotId: string, fuelLevel: number | null) => void }) {
  const free = spots.filter((spot) => !spot.vehicle && canUseSpot(trip.vehicle, spot)); const [spotId, setSpotId] = useState(initialSpotId); const [fuelLevel, setFuelLevel] = useState(trip.vehicle.fuelLevel);
  const selected = free.find((spot) => spot.id === spotId);
  const [choosing, setChoosing] = useState(!selected);
  const holdingCodes = free.filter((spot) => spot.role === "HOLDING").map((spot) => spot.code);
  const changeSpot = () => { if (onChangeSpot) onChangeSpot(); else setChoosing(true); };
  return <DialogShell busy={submitting} title={`${trip.vehicle.name}を返却`} subtitle={choosing ? `返却した区画を選び、残量を確認してください${holdingCodes.length ? `（${holdingCodes.join("・")}は実在しない仮置き）` : ""}` : "返却先と残量を確認して完了してください"} onClose={onClose}><div className="space-y-4">
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-slate-100"><CarFront className="size-6" style={{ color: trip.vehicle.color }} /></span><div className="min-w-0 flex-1"><p className="truncate font-black">{trip.vehicle.name}</p><p className="truncate text-xs font-bold text-slate-500">{trip.vehicle.code} ・ {trip.employee.name}</p></div></div>
      <div className={cn("mt-3 flex items-center gap-2 rounded-xl px-3 py-2", selected ? selected.role === "HOLDING" ? "bg-zinc-200 text-zinc-800" : "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800")}><MapPin className="size-4 shrink-0" /><p className="mr-auto text-sm font-black"><span className="mr-2 text-xs font-bold opacity-70">返却先</span>{selected ? formatSpotLabel(selected) : "未選択"}</p>{selected && !choosing ? <Button variant="ghost" className="min-h-8 shrink-0 px-3 text-xs" onClick={changeSpot}>変更</Button> : null}</div>
    </div>
    {choosing ? <div className="grid grid-cols-3 gap-2">{free.map((spot) => <button key={spot.id} onClick={() => setSpotId(spot.id)} className={cn("min-h-14 rounded-xl border text-sm font-black", spotId === spot.id ? "border-emerald-500 bg-emerald-50 text-emerald-700 ring-2 ring-emerald-200" : spot.role === "HOLDING" ? "border-dotted border-zinc-400 bg-zinc-100 text-zinc-700" : "border-slate-200")}>{formatSpotLabel(spot)}</button>)}</div> : null}
    <FuelLevelPicker value={fuelLevel} onChange={setFuelLevel} />
    <Button className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={!selected || submitting} onClick={() => selected && onSubmit(selected.id, fuelLevel)}>{submitting ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}{submitting ? "返却登録中…" : "返却を完了"}</Button>
  </div></DialogShell>;
}

// キーは車両番号順に保管しているため、車両名の上に車両番号を小さな札のように添える。狭い配置図では車の絵と同じ行に並べる。
// 横向きの区画は高さが低いので、車の絵を左、車両番号・車両名・ナンバーを右に並べた2列にする。狭い配置図では右下の残量と重ならないよう左に寄せる。
const vehicleTileContent = (vehicle: Vehicle, horizontal: boolean, offSite = false) => {
  const code = <span className="inline-block rounded-full border border-slate-300 bg-white/80 px-1 text-[8px] font-black leading-tight tracking-[0.08em] text-slate-700 @2xl:px-1.5 @2xl:text-[10px]">{vehicle.code}</span>;
  const plate = formatPlateShort(vehicle.plateNumber);
  const extra = vehicle.status === "MAINTENANCE" ? <small className="mt-0.5 block whitespace-nowrap text-[7px] font-black text-amber-800">{offSite ? "車検で不在" : "整備中"}</small> : <VehicleEquipmentBadges vehicle={vehicle} compact />;
  if (horizontal) return <span className="flex w-full max-w-full items-center gap-1 px-1 text-left @4xl:w-auto @4xl:gap-1.5 @4xl:px-1.5"><span className="flex shrink-0 flex-col items-center"><CarFront className="size-4 @4xl:size-6" style={{ color: vehicle.color }} />{extra}</span><span className="min-w-0 text-[8px] leading-none">{code}<b className="block truncate text-[8px] leading-tight @2xl:text-[10px] @4xl:mt-0.5 @4xl:text-[11px]">{vehicle.name}</b><small className="block whitespace-nowrap text-[7px] font-bold leading-none text-slate-500 @2xl:text-[8px] @4xl:text-[9px]">{plate}</small></span></span>;
  return <><span className="flex items-center justify-center gap-1 @4xl:flex-col @4xl:gap-0.5"><CarFront className="size-3.5 shrink-0 @2xl:size-4 @4xl:size-5" style={{ color: vehicle.color }} />{code}</span><b className="mt-0.5 block max-w-full truncate px-1 text-[8px] leading-tight @2xl:text-[10px]">{vehicle.name}</b><small className="mt-0.5 block whitespace-nowrap text-[7px] font-bold leading-none text-slate-500 @2xl:text-[8px]">{plate}</small>{extra}</>;
};
const fuelFillHeight = (level: number) => `${Math.max(6, level * 25)}%`;
// 残量が変わった車両だけ、少しの間タイルの液面を波打たせる。初回表示では揺らさない。
function useFuelChangeWave(spots: ParkingSpot[]) {
  const previousLevels = useRef<Map<string, number | null> | null>(null);
  const [wavingVehicleIds, setWavingVehicleIds] = useState<string[]>([]);
  useEffect(() => {
    const levels = new Map(spots.flatMap((spot) => spot.vehicle ? [[spot.vehicle.id, spot.vehicle.fuelLevel] as const] : []));
    const previous = previousLevels.current;
    previousLevels.current = levels;
    if (!previous) return;
    const changed = [...levels].filter(([id, level]) => level !== null && previous.get(id) !== level).map(([id]) => id);
    if (changed.length) setWavingVehicleIds((ids) => [...new Set([...ids, ...changed])]);
  }, [spots]);
  useEffect(() => {
    if (!wavingVehicleIds.length) return;
    const timer = setTimeout(() => setWavingVehicleIds([]), 1900);
    return () => clearTimeout(timer);
  }, [wavingVehicleIds]);
  return wavingVehicleIds;
}
function FuelFill({ level, waving }: { level: number; waving: boolean }) {
  return <span aria-hidden className={cn("pointer-events-none absolute inset-x-0 bottom-0 rounded-b-[2px] border-t transition-[height] duration-700 ease-out motion-reduce:transition-none", isLowFuel(level) ? "border-amber-500/80 bg-amber-300/70" : "border-emerald-500/70 bg-emerald-300/50", waving && "fuel-wave border-transparent")} style={{ height: fuelFillHeight(level) }} />;
}
function FuelGauge({ level, className }: { level: number; className?: string }) {
  return <span aria-hidden className={cn("relative block overflow-hidden rounded-b-md rounded-t-sm border-2 border-slate-300 bg-white", className)}><span className={cn("absolute inset-x-0 bottom-0", isLowFuel(level) ? "bg-amber-300" : "bg-emerald-300")} style={{ height: fuelFillHeight(level) }} /></span>;
}
function FuelLevelPicker({ value, onChange, emptyHint = "選ばずに返却すると、残量は記録されません" }: { value: number | null; onChange: (level: number) => void; emptyHint?: string }) {
  return <fieldset><legend className="mb-1.5 text-xs font-bold text-slate-600">残量（おおよそで構いません）</legend><div className="grid grid-cols-5 gap-2">{FUEL_LEVEL_LABELS.map((label, level) => ({ label, level })).reverse().map(({ label, level }) => <button key={label} type="button" aria-pressed={value === level} aria-label={`残量 ${label}`} onClick={() => onChange(level)} className={cn("flex min-h-16 flex-col items-center justify-end gap-1 rounded-xl border p-1.5 text-sm font-black transition", value === level ? isLowFuel(level) ? "border-amber-500 bg-amber-50 text-amber-800 ring-2 ring-amber-200" : "border-emerald-500 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-200" : "border-slate-200 text-slate-600 hover:bg-slate-50")}><FuelGauge level={level} className="h-7 w-5" />{label}</button>)}</div>{value === null ? <p className="mt-1.5 text-[11px] text-slate-500">{emptyHint}</p> : null}</fieldset>;
}
function FuelLevelDialog({ vehicle, submitting, onClose, onSubmit }: { vehicle: Vehicle; submitting: boolean; onClose: () => void; onSubmit: (fuelLevel: number) => void }) {
  const [fuelLevel, setFuelLevel] = useState(vehicle.fuelLevel);
  const changed = fuelLevel !== null && fuelLevel !== vehicle.fuelLevel;
  return <DialogShell busy={submitting} title="残量を変更" subtitle={`${vehicle.name}（現在：${vehicle.fuelLevel === null ? "未登録" : formatFuelLevel(vehicle.fuelLevel)}）の残量を選び直してください`} onClose={onClose}><div className="space-y-4"><FuelLevelPicker value={fuelLevel} onChange={setFuelLevel} emptyHint="まだ残量が登録されていません" /><Button className="w-full" disabled={!changed || submitting} onClick={() => fuelLevel !== null && onSubmit(fuelLevel)}>{submitting ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}{submitting ? "保存中…" : "残量を保存"}</Button></div></DialogShell>;
}

// ヘッダーの「NFC読み取り」。社員証なら利用者を認証し、車両タグなら利用開始・返却の画面を開く。
function NfcDialog({ employees, vehicles, onEmployee, onVehicle, onClose }: { employees: Employee[]; vehicles: Vehicle[]; onEmployee: (e: Employee) => void; onVehicle: (v: Vehicle) => void; onClose: () => void }) {
  const development = process.env.NODE_ENV === "development";
  const [error, setError] = useState("");
  // 登録されていないカード・タグのUID。設定の「NFCを確認」や登録で使えるよう画面に出す。
  const [unknownUid, setUnknownUid] = useState("");
  const [scanEnabled, setScanEnabled] = useState(true);
  const [scanTimedOut, setScanTimedOut] = useState(false);
  const bridgeStatus = useNfcBridge(scanEnabled, async (uid) => {
    setError(""); setUnknownUid("");
    try {
      const result = await resolveNfcUid(uid);
      const person = result?.kind === "employee" ? employees.find((item) => item.id === result.id) : undefined;
      if (person) { playNfcSound("success"); setScanEnabled(false); setScanTimedOut(false); onEmployee(person); return; }
      const vehicle = result?.kind === "vehicle" ? vehicles.find((item) => item.id === result.id) : undefined;
      if (vehicle) { playNfcSound(vehicle.status === "MAINTENANCE" ? "error" : "success"); setScanEnabled(false); setScanTimedOut(false); onVehicle(vehicle); return; }
      playNfcSound("error");
      setUnknownUid(uid);
    } catch { playNfcSound("error"); setError("NFCタグを確認できませんでした。接続状態を確認してください"); }
  });
  useNfcScanTimeout(scanEnabled, () => {
    setScanEnabled(false);
    setScanTimedOut(true);
  });
  const retry = () => { setScanEnabled(true); setScanTimedOut(false); setError(""); setUnknownUid(""); };
  return <DialogShell title="NFC読み取り" subtitle="社員証または車両タグをリーダーにかざしてください" onClose={onClose}><div className="text-center">
    <div className={cn("mx-auto mb-4 grid size-20 place-items-center rounded-full", scanTimedOut ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-600")}><Nfc className={cn("size-10", scanEnabled && "animate-pulse")} /></div>
    <p className="text-sm font-bold">{scanTimedOut ? "読み取れませんでした" : "社員証・車両タグをかざしてください"}</p>
    <p role="status" aria-live="polite" className={cn("mb-4 mt-1 text-[11px]", scanTimedOut ? "font-bold text-amber-700" : bridgeStatus === "ready" ? "font-bold text-emerald-700" : "text-slate-500")}>{scanTimedOut ? "15秒以内に読み取れませんでした。再試行するか、画面を閉じて手動で操作してください。" : nfcBridgeStatusText(bridgeStatus)}</p>
    <div className="mb-4 grid grid-cols-2 gap-2 text-left">
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3"><UserRound className="size-5 shrink-0 text-emerald-600" /><span className="min-w-0"><b className="block text-xs">社員証</b><span className="block text-[11px] text-slate-500">利用者として認証</span></span></div>
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3"><CarFront className="size-5 shrink-0 text-blue-600" /><span className="min-w-0"><b className="block text-xs">車両タグ</b><span className="block text-[11px] text-slate-500">利用開始・返却を開く</span></span></div>
    </div>
    {unknownUid ? <div role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-left"><p className="text-xs font-black text-amber-800">登録されていないカード・タグです</p><p className="mt-1 text-[11px] font-bold text-amber-800">UID <span className="select-all font-mono">{unknownUid}</span></p><p className="mt-1 text-[11px] text-amber-700">別のカード・タグはそのままかざせます。登録は設定の社員登録・車両登録で行います。</p></div> : null}
    {error ? <p role="alert" className="mb-4 rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-700">{error}</p> : null}
    {scanTimedOut ? <button type="button" onClick={retry} className="mb-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 text-sm font-bold text-white hover:bg-amber-700"><Nfc className="size-4" />NFC読取を再試行</button> : <NfcBridgeHelp status={bridgeStatus} defaultOpen className="mb-4" />}
    {development ? <div className="grid grid-cols-2 gap-3 text-left"><div><p className="mb-2 text-xs font-bold text-slate-400">社員（開発用）</p>{employees.slice(0, 3).map((p) => <button key={p.id} onClick={() => onEmployee(p)} className="mb-2 w-full rounded-xl border border-slate-200 p-3 text-xs font-bold hover:bg-slate-50">{p.name}<small className="block font-normal text-slate-400">{p.code}</small></button>)}</div><div><p className="mb-2 text-xs font-bold text-slate-400">車両（開発用）</p>{vehicles.slice(0, 3).map((v) => <button key={v.id} onClick={() => onVehicle(v)} className="mb-2 w-full rounded-xl border border-slate-200 p-3 text-xs font-bold hover:bg-slate-50">{v.name}<small className="block font-normal text-slate-400">{v.code}</small></button>)}</div></div> : null}
  </div></DialogShell>;
}
// ヘッダーの利用者チップから開く。各自のPCでは一覧から選び、共用端末では社員証をかざしても選べる。
function UserPickerDialog({ employees, currentId, nfcEnabled, onSelect, onClose }: { employees: Employee[]; currentId: string | null; nfcEnabled: boolean; onSelect: (e: Employee) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [nfcMessage, setNfcMessage] = useState("");
  const bridgeStatus = useNfcBridge(nfcEnabled, async (uid) => {
    setNfcMessage("");
    try {
      const result = await resolveNfcUid(uid);
      const person = result?.kind === "employee" ? employees.find((item) => item.id === result.id) : undefined;
      if (person) { playNfcSound("success"); onSelect(person); return; }
      playNfcSound("error");
      setNfcMessage(result?.kind === "vehicle" ? "車両タグです。利用者を選ぶときは社員証をかざしてください" : `登録されていない社員証です（UID ${uid}）`);
    } catch { playNfcSound("error"); setNfcMessage("NFCタグを確認できませんでした。一覧から選んでください"); }
  });
  const keyword = query.trim().toLowerCase();
  const filtered = [...employees].sort((left, right) => left.code.localeCompare(right.code, "ja", { numeric: true })).filter((person) => !keyword || `${person.code} ${person.name} ${person.department}`.toLowerCase().includes(keyword));
  return <DialogShell title="利用者を選ぶ" subtitle={nfcEnabled ? "社員証をかざすか、一覧から選んでください" : "一覧から自分の名前を選んでください"} onClose={onClose}>
    {nfcEnabled ? <div className="mb-3 flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-blue-800"><Nfc className={cn("size-6 shrink-0", bridgeStatus === "ready" && "animate-pulse")} /><div className="min-w-0"><p className="text-sm font-black">社員証をかざすと、そのまま選べます</p><p role="status" aria-live="polite" className="text-[11px]">{nfcBridgeStatusText(bridgeStatus)}</p></div></div> : null}
    {nfcMessage ? <p role="alert" className="mb-3 rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-800">{nfcMessage}</p> : null}
    <input aria-label="社員番号・名前・部署で検索" autoFocus={!nfcEnabled} className={field} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="社員番号・名前・部署で検索" />
    <ul className="mt-3 max-h-[min(24rem,50vh)] space-y-1.5 overflow-y-auto pr-1">{filtered.map((person) => <li key={person.id}><button type="button" onClick={() => onSelect(person)} aria-current={person.id === currentId ? "true" : undefined} className={cn("flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition", person.id === currentId ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50")}><span className="w-14 shrink-0 font-mono text-xs text-slate-500">{person.code}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-black">{person.name}</span><span className="block truncate text-[11px] text-slate-500">{person.department}</span></span>{person.id === currentId ? <span className="flex shrink-0 items-center gap-1 text-[11px] font-bold text-emerald-700"><Check className="size-3.5" />選択中</span> : null}</button></li>)}</ul>
    {filtered.length === 0 ? <p className="mt-3 rounded-xl border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500">該当する社員がいません</p> : null}
  </DialogShell>;
}
function Label({ text, children }: { text: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-600">{text}</span>{children}</label>; }
