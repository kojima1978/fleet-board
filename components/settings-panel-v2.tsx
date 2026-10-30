"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CarFront, Check, Download, FileJson, Mail, MapPin, Nfc, Pencil, Plus, Power, QrCode, RotateCcw, Search, Send, Upload, UserRound, Wrench, X } from "lucide-react";
import type { DashboardData, Employee, ParkingSpot, Vehicle } from "@/lib/types";
import { canUseSpot, formatSpotLabel, isCustomerSpot } from "@/lib/parking-spots";
import { CustomerSpotNotice } from "./customer-spot-notice";
import { normalizeNfcUid, sameNfcUid } from "@/lib/nfc";
import { isLightVehicleColor, VEHICLE_COLORS, vehicleColorName, vehicleIconStyle } from "@/lib/vehicle-colors";
import { isRecordCode, normalizeRecordCode, RECORD_CODE_EXAMPLES, recordCodeMessage, sanitizeRecordCodeInput } from "@/lib/record-codes";
import { nfcBridgeStatusText, useNfcBridge } from "@/lib/use-nfc-bridge";
import { activeMaintenanceOf, MaintenanceDialog } from "./maintenance-dialog";
import { NfcBridgeHelp } from "./nfc-bridge-help";
import { Button, Card, cn } from "./ui";

type Mutate = (body: object, success: string) => Promise<boolean>;
type StatusFilter = "all" | "active" | "inactive" | "inUse" | "maintenance";
type NfcFilter = "all" | "registered" | "unregistered";
type EmailFilter = "all" | "registered" | "unregistered";
const matchesNfc = (filter: NfcFilter, nfcUid: string) => filter === "all" || (filter === "registered") === !!nfcUid;
type ConfirmTarget = {
  id: string;
  name: string;
  active: boolean;
  version: number;
};
type NfcChangeConfirm = { kind: "employee" | "vehicle"; previous: string; next: string };
type ImportRow = Record<string, unknown>;

const emptyEmployee = {
  code: "",
  name: "",
  email: "",
  department: "",
  nfcUid: "",
};
const emptyVehicle = {
  code: "",
  name: "",
  plateNumber: "",
  nfcUid: "",
  spotId: "",
  color: "#2563eb",
  hasEtc: false,
  hasNavigation: false,
  hasWinterTires: false,
  hasBackMonitor: false,
  isKei: false,
  fuelCard: "",
};
// ガソリンカードは管理名だけを保存する。APIの上限と合わせる。
const FUEL_CARD_MAX = 40;
const field = "min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500";
const NFC_SCAN_TIMEOUT_MS = 15_000;
const DEFAULT_PAGE_SIZE = 30;
const PAGE_SIZES = [30, 60, 100] as const;
type PageSize = (typeof PAGE_SIZES)[number];
const nfcUidLabel = (uid: string) => uid || "NFC未登録";
// 社員一覧の見出しと各行で同じ列幅を使う。広い画面でも列を広げすぎず、視線移動を短くする。
const employeeGrid = "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 md:grid-cols-[84px_minmax(0,12rem)_minmax(0,8rem)_minmax(0,12rem)_auto] md:gap-4 xl:grid-cols-[88px_minmax(0,10rem)_minmax(0,14rem)_minmax(0,8rem)_minmax(0,12rem)_auto]";
// 車両は列が多いため、広い画面でだけ表形式にする。狭い画面では状態と駐車位置を車両名の下に出す。
// 広い画面でも一覧を横へ広げすぎず、状態列だけを残り幅に応じて伸縮させる。
// 操作ボタンの幅は行ごとに違うため、伸び縮みは操作の手前の列に任せ、ほかの列の位置を全行でそろえる。
const vehicleGrid = "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 xl:grid-cols-[88px_9.5rem_7rem_7.5rem_6.5rem_minmax(0,1fr)_auto] xl:gap-3";

export function SettingsPanelV2({ kind, data, mutate }: { kind: "employee" | "vehicle"; data: DashboardData; mutate: Mutate }) {
  const [query, setQuery] = useState("");
  // 利用停止した社員・車両は年々増えるため、初期表示では有効なものだけを出す。
  const [status, setStatus] = useState<StatusFilter>("active");
  const [department, setDepartment] = useState("all");
  // NFCは任意のため、カード・タグを配る前に未登録だけを一覧できるようにする。
  const [nfc, setNfc] = useState<NfcFilter>("all");
  const [email, setEmail] = useState<EmailFilter>("all");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [nfcEmployee, setNfcEmployee] = useState<Employee | null>(null);
  const [nfcEmployeeValue, setNfcEmployeeValue] = useState("");
  const [nfcVehicle, setNfcVehicle] = useState<Vehicle | null>(null);
  const [nfcVehicleValue, setNfcVehicleValue] = useState("");
  const [employeeForm, setEmployeeForm] = useState(emptyEmployee);
  const [vehicleForm, setVehicleForm] = useState(emptyVehicle);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);
  const [maintenanceVehicleId, setMaintenanceVehicleId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [highlightId, setHighlightId] = useState("");
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const [nfcChangeConfirm, setNfcChangeConfirm] = useState<NfcChangeConfirm | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [nfcCheckOpen, setNfcCheckOpen] = useState(false);
  const [mailOpen, setMailOpen] = useState(false);
  const [qrPreview, setQrPreview] = useState<{
    kind: "employee" | "vehicle";
    id: string;
    code: string;
    name: string;
    email?: string;
    version?: number;
  } | null>(null);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  // JSON取込の行番号ごとに選んだ駐車区画。未選択の行は位置未設定で登録する。
  const [importSpots, setImportSpots] = useState<Record<number, string>>({});
  const [importError, setImportError] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [urlHydrated, setUrlHydrated] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const drawerRef = useRef<HTMLElement | null>(null);
  const drawerReturnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setQuery(params.get("q") ?? "");
    const savedStatus = params.get("status") as StatusFilter | null;
    setStatus(savedStatus && ["all", "active", "inactive", "inUse", "maintenance"].includes(savedStatus) ? savedStatus : "active");
    setDepartment(params.get("department") ?? "all");
    const savedNfc = params.get("nfc") as NfcFilter | null;
    setNfc(savedNfc === "registered" || savedNfc === "unregistered" ? savedNfc : "all");
    const savedEmail = params.get("email") as EmailFilter | null;
    setEmail(savedEmail === "registered" || savedEmail === "unregistered" ? savedEmail : "all");
    const savedPageSize = Number(params.get("limit"));
    setPageSize(PAGE_SIZES.includes(savedPageSize as PageSize) ? (savedPageSize as PageSize) : DEFAULT_PAGE_SIZE);
    setUrlHydrated(true);
  }, [kind]);

  useEffect(() => {
    if (!urlHydrated) return;
    const params = new URLSearchParams(window.location.search);
    query ? params.set("q", query) : params.delete("q");
    status !== "active" ? params.set("status", status) : params.delete("status");
    nfc !== "all" ? params.set("nfc", nfc) : params.delete("nfc");
    kind === "employee" && email !== "all" ? params.set("email", email) : params.delete("email");
    kind === "employee" && department !== "all" ? params.set("department", department) : params.delete("department");
    pageSize !== DEFAULT_PAGE_SIZE ? params.set("limit", String(pageSize)) : params.delete("limit");
    const suffix = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${suffix ? `?${suffix}` : ""}`);
  }, [department, email, kind, nfc, pageSize, query, status, urlHydrated]);

  useEffect(() => {
    if (!highlightId) return;
    const timer = window.setTimeout(() => setHighlightId(""), 3000);
    return () => window.clearTimeout(timer);
  }, [highlightId]);

  // 絞り込みには利用停止中の部署も出す。社員の部署選択は利用中の部署だけにし、編集中の社員が今いる部署は停止中でも残す。
  const departments = useMemo(() => data.departments.map((item) => item.name), [data.departments]);
  const selectableDepartments = useMemo(() => {
    const names = data.departments.filter((item) => item.active).map((item) => item.name);
    return editingEmployee && !names.includes(editingEmployee.department) ? [...names, editingEmployee.department] : names;
  }, [data.departments, editingEmployee]);
  // 部署画面の「社員 N人」から開いたときは、その部署で絞り込んだ状態にする。
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("department");
    if (requested) setDepartment(requested);
  }, []);
  // 件数が多い場合も入力を妨げないよう、一覧の絞り込みだけを遅延させる。
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const employees = useMemo(
    () =>
      data.employees.filter((person) => {
        const matchesQuery = !normalizedQuery || [person.code, person.name, person.email, person.department, person.nfcUid].some((value) => value.toLowerCase().includes(normalizedQuery));
        const matchesStatus = status === "all" || (status === "active" && person.active) || (status === "inactive" && !person.active);
        const matchesEmail = email === "all" || (email === "registered") === !!person.email;
        return matchesQuery && matchesStatus && matchesEmail && matchesNfc(nfc, person.nfcUid) && (department === "all" || person.department === department);
      }),
    [data.employees, department, email, nfc, normalizedQuery, status],
  );
  const vehicles = useMemo(
    () =>
      data.vehicles.filter((vehicle) => {
        const matchesQuery = !normalizedQuery || [vehicle.code, vehicle.name, vehicle.plateNumber, vehicle.fuelCard, vehicle.nfcUid].some((value) => value.toLowerCase().includes(normalizedQuery));
        const matchesStatus = status === "all" || (status === "active" && vehicle.active) || (status === "inactive" && !vehicle.active) || (status === "inUse" && vehicle.active && vehicle.status === "IN_USE") || (status === "maintenance" && vehicle.active && vehicle.status === "MAINTENANCE");
        return matchesQuery && matchesStatus && matchesNfc(nfc, vehicle.nfcUid);
      }),
    [data.vehicles, nfc, normalizedQuery, status],
  );
  useEffect(() => {
    setPage(1);
  }, [department, email, kind, nfc, normalizedQuery, pageSize, status]);

  const currentNfc = kind === "employee" ? employeeForm.nfcUid : vehicleForm.nfcUid;
  const editingId = editingEmployee?.id ?? editingVehicle?.id;
  const duplicateNfc = currentNfc ? [...data.employees.filter((person) => person.active), ...data.vehicles].find((item) => item.id !== editingId && sameNfcUid(item.nfcUid, currentNfc)) : undefined;
  const nfcVehicleDuplicate = nfcVehicleValue && nfcVehicle
    ? [...data.employees.filter((person) => person.active), ...data.vehicles].find((item) => item.id !== nfcVehicle.id && sameNfcUid(item.nfcUid, nfcVehicleValue))
    : undefined;
  const nfcEmployeeDuplicate = nfcEmployeeValue && nfcEmployee
    ? [...data.employees.filter((person) => person.active), ...data.vehicles].find((item) => item.id !== nfcEmployee.id && sameNfcUid(item.nfcUid, nfcEmployeeValue))
    : undefined;

  const employeeCodeInvalid = !isRecordCode(normalizeRecordCode(employeeForm.code));
  const vehicleCodeInvalid = !isRecordCode(normalizeRecordCode(vehicleForm.code));
  const employeeDirty =
    JSON.stringify(employeeForm) !==
    JSON.stringify(
      editingEmployee
        ? {
            code: editingEmployee.code,
            name: editingEmployee.name,
            email: editingEmployee.email,
            department: editingEmployee.department,
            nfcUid: editingEmployee.nfcUid,
          }
        : emptyEmployee,
    );
  const vehicleDirty =
    JSON.stringify(vehicleForm) !==
    JSON.stringify(
      editingVehicle
        ? {
            code: editingVehicle.code,
            name: editingVehicle.name,
            plateNumber: editingVehicle.plateNumber,
            nfcUid: editingVehicle.nfcUid,
            spotId: editingVehicle.parkingSpotId ?? "",
            color: editingVehicle.color,
            hasEtc: editingVehicle.hasEtc,
            hasNavigation: editingVehicle.hasNavigation,
            hasWinterTires: editingVehicle.hasWinterTires,
            hasBackMonitor: editingVehicle.hasBackMonitor,
            isKei: editingVehicle.isKei,
            fuelCard: editingVehicle.fuelCard,
          }
        : emptyVehicle,
    );
  const hasUnsavedChanges = drawerOpen && (kind === "employee" ? employeeDirty : vehicleDirty);
  const closeDrawer = useCallback(
    (force = false) => {
      if (!force && drawerOpen && (kind === "employee" ? employeeDirty : vehicleDirty)) {
        setDiscardConfirm(true);
        return;
      }
      setDrawerOpen(false);
      setEditingEmployee(null);
      setEditingVehicle(null);
      setEmployeeForm(emptyEmployee);
      setVehicleForm(emptyVehicle);
      setScanning(false);
      setNfcChangeConfirm(null);
    },
    [drawerOpen, employeeDirty, kind, vehicleDirty],
  );

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
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
    return () => {
      window.clearTimeout(timer);
      drawerReturnFocus.current?.focus();
    };
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen && !confirmTarget && !maintenanceVehicleId && !nfcChangeConfirm && !nfcEmployee && !nfcVehicle) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const activeLayer = document.querySelector<HTMLElement>("[role='alertdialog'], [data-focus-layer]") ?? drawerRef.current;
      if (event.key === "Escape") {
        event.preventDefault();
        if (submitting) return;
        if (discardConfirm) {
          setDiscardConfirm(false);
          return;
        }
        if (nfcChangeConfirm) {
          setNfcChangeConfirm(null);
          return;
        }
        if (maintenanceVehicleId) {
          setMaintenanceVehicleId(null);
          return;
        }
        if (confirmTarget) {
          setConfirmTarget(null);
          return;
        }
        if (nfcEmployee) {
          setNfcEmployee(null);
          setNfcEmployeeValue("");
          setScanning(false);
          return;
        }
        if (nfcVehicle) {
          setNfcVehicle(null);
          setNfcVehicleValue("");
          setScanning(false);
          return;
        }
        closeDrawer();
        return;
      }
      if (event.key !== "Tab" || !activeLayer) return;
      const focusable = [...activeLayer.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])")];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeDrawer, confirmTarget, discardConfirm, drawerOpen, maintenanceVehicleId, nfcChangeConfirm, nfcEmployee, nfcVehicle, submitting]);
  const openCreate = () => {
    closeDrawer(true);
    setDrawerOpen(true);
  };
  const openEmployee = (person: Employee) => {
    setEditingEmployee(person);
    setEmployeeForm({
      code: person.code,
      name: person.name,
      email: person.email,
      department: person.department,
      nfcUid: person.nfcUid,
    });
    setDrawerOpen(true);
  };
  const openEmployeeNfc = (person: Employee) => {
    setNfcEmployee(person);
    setNfcEmployeeValue(person.nfcUid);
    setScanning(false);
  };
  const closeEmployeeNfc = (force = false) => {
    if (submitting && !force) return;
    setNfcEmployee(null);
    setNfcEmployeeValue("");
    setScanning(false);
  };
  const openVehicle = (vehicle: Vehicle) => {
    setEditingVehicle(vehicle);
    setVehicleForm({
      code: vehicle.code,
      name: vehicle.name,
      plateNumber: vehicle.plateNumber,
      nfcUid: vehicle.nfcUid,
      spotId: vehicle.parkingSpotId ?? "",
      color: vehicle.color,
      hasEtc: vehicle.hasEtc,
      hasNavigation: vehicle.hasNavigation,
      hasWinterTires: vehicle.hasWinterTires,
      hasBackMonitor: vehicle.hasBackMonitor,
      isKei: vehicle.isKei,
      fuelCard: vehicle.fuelCard,
    });
    setDrawerOpen(true);
  };
  const openVehicleNfc = (vehicle: Vehicle) => {
    setNfcVehicle(vehicle);
    setNfcVehicleValue(vehicle.nfcUid);
    setScanning(false);
  };
  const closeVehicleNfc = (force = false) => {
    if (submitting && !force) return;
    setNfcVehicle(null);
    setNfcVehicleValue("");
    setScanning(false);
  };
  const beginNfcScan = () => setScanning(true);
  const closeImport = () => {
    if (submitting) return;
    setImportOpen(false);
    setImportRows([]);
    setImportSpots({});
    setImportError("");
    setImportFileName("");
  };
  const readImportFile = async (file?: File) => {
    setImportRows([]);
    setImportSpots({});
    setImportError("");
    setImportFileName(file?.name ?? "");
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setImportError("ファイルサイズは2MB以下にしてください");
      return;
    }
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const rows = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>)[kind === "employee" ? "employees" : "vehicles"] : undefined;
      if (!Array.isArray(rows) || rows.length === 0) throw new Error("配列形式のデータがありません");
      if (rows.length > 500) throw new Error("一度に取り込めるのは500件までです");
      const required = kind === "employee" ? ["code", "name", "department"] : ["code", "name", "plateNumber"];
      rows.forEach((row, index) => {
        if (!row || typeof row !== "object" || required.some((key) => typeof (row as Record<string, unknown>)[key] !== "string" || !(row as Record<string, string>)[key].trim())) throw new Error(`${index + 1}件目の必須項目を確認してください`);
        if (!isRecordCode(normalizeRecordCode((row as Record<string, string>).code))) throw new Error(`${index + 1}件目の${recordCodeMessage(kind)}`);
        const nfcUid = (row as ImportRow).nfcUid;
        if (nfcUid != null && typeof nfcUid !== "string") throw new Error(`${index + 1}件目のNFC UIDは文字列または空欄にしてください`);
        const email = (row as ImportRow).email;
        if (kind === "employee" && email != null && (typeof email !== "string" || (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())))) throw new Error(`${index + 1}件目のメールアドレスを確認してください`);
        if (kind === "vehicle" && "color" in row && (typeof (row as ImportRow).color !== "string" || !/^#[0-9a-fA-F]{6}$/.test((row as ImportRow).color as string))) throw new Error(`${index + 1}件目の表示色は #2563EB の形式で入力してください`);
        if (kind === "vehicle" && "hasEtc" in row && typeof (row as ImportRow).hasEtc !== "boolean") throw new Error(`${index + 1}件目のhasEtcはtrueまたはfalseで指定してください`);
        if (kind === "vehicle" && "hasNavigation" in row && typeof (row as ImportRow).hasNavigation !== "boolean") throw new Error(`${index + 1}件目のhasNavigationはtrueまたはfalseで指定してください`);
        if (kind === "vehicle" && "hasWinterTires" in row && typeof (row as ImportRow).hasWinterTires !== "boolean") throw new Error(`${index + 1}件目のhasWinterTiresはtrueまたはfalseで指定してください`);
        if (kind === "vehicle" && "hasBackMonitor" in row && typeof (row as ImportRow).hasBackMonitor !== "boolean") throw new Error(`${index + 1}件目のhasBackMonitorはtrueまたはfalseで指定してください`);
        if (kind === "vehicle" && "isKei" in row && typeof (row as ImportRow).isKei !== "boolean") throw new Error(`${index + 1}件目のisKeiはtrueまたはfalseで指定してください`);
        const fuelCard = (row as ImportRow).fuelCard;
        if (kind === "vehicle" && fuelCard != null && (typeof fuelCard !== "string" || fuelCard.trim().length > FUEL_CARD_MAX)) throw new Error(`${index + 1}件目のfuelCardは${FUEL_CARD_MAX}文字以内の文字列にしてください`);
      });
      setImportRows(
        (rows as ImportRow[]).map((row) => ({
          ...row,
          code: normalizeRecordCode(String(row.code)),
        })),
      );
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "JSONファイルを読み取れませんでした");
    }
  };
  const downloadTemplate = () => {
    const example =
      kind === "employee"
        ? [
            {
              code: "E007",
              name: "山田 太郎",
              email: "yamada@example.jp",
              department: "営業部",
              nfcUid: "04AABBCCDDEEFF",
            },
            { code: "E008", name: "鈴木 花子", department: "総務部" },
          ]
        : [
            {
              code: "C018",
              name: "営業車18",
              plateNumber: "品川 500 あ 12-34",
              nfcUid: "04AABBCCDDEE11",
              color: "#2563EB",
              hasEtc: true,
              hasNavigation: true,
              hasWinterTires: true,
              hasBackMonitor: true,
              isKei: false,
              fuelCard: "出光 末尾1234",
            },
            {
              code: "C019",
              name: "営業車19",
              plateNumber: "品川 500 い 56-78",
              color: "#0891B2",
              hasEtc: false,
              hasNavigation: true,
              hasWinterTires: false,
              hasBackMonitor: false,
              isKei: true,
            },
          ];
    const blob = new Blob([JSON.stringify(example, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = kind === "employee" ? "employees-template.json" : "vehicles-template.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };
  // 新しい車両を置ける区画は、有効で空いていて専用区画でないもの。
  const freeImportSpots = data.spots.filter((spot) => spot.enabled && !spot.vehicle && canUseSpot({ id: "" }, spot));
  // 利用再開した車両は、空いている仮置き区画へ自動で置く。
  const freeHoldingCount = freeImportSpots.filter((spot) => spot.role === "HOLDING").length;
  const importPlacedCount = Object.values(importSpots).filter(Boolean).length;
  const importUnplacedCount = importRows.length - importPlacedCount;
  const assignImportSpots = () => {
    const used = new Set(Object.values(importSpots));
    const free = freeImportSpots.filter((spot) => !used.has(spot.id));
    const next = { ...importSpots };
    importRows.forEach((_, index) => {
      if (!next[index] && free.length) next[index] = free.shift()!.id;
    });
    setImportSpots(next);
  };
  const submitImport = async () => {
    if (submitting || importRows.length === 0) return;
    setSubmitting(true);
    try {
      const items = importRows.map((row, index) => {
        const nfcUid = typeof row.nfcUid === "string" && row.nfcUid.trim() ? normalizeNfcUid(row.nfcUid) : undefined;
        return kind === "employee"
          ? {
              code: String(row.code).trim(),
              name: String(row.name).trim(),
              email: typeof row.email === "string" && row.email.trim() ? row.email.trim().toLowerCase() : undefined,
              department: String(row.department).trim(),
              nfcUid,
            }
          : {
              code: String(row.code).trim(),
              name: String(row.name).trim(),
              plateNumber: String(row.plateNumber).trim(),
              nfcUid,
              color: typeof row.color === "string" ? row.color : "#2563eb",
              hasEtc: row.hasEtc === true,
              hasNavigation: row.hasNavigation === true,
              hasWinterTires: row.hasWinterTires === true,
              hasBackMonitor: row.hasBackMonitor === true,
              isKei: row.isKei === true,
              fuelCard: typeof row.fuelCard === "string" ? row.fuelCard.trim() : "",
              ...(importSpots[index] ? { spotId: importSpots[index] } : {}),
            };
      });
      // 区画を選ばなかった車両は位置未設定になるため、配置図で置く必要があることを伝える。
      const message = kind === "employee" ? `${items.length}人をJSONから登録しました` : `${items.length}台をJSONから登録しました${importUnplacedCount ? `。位置未設定 ${importUnplacedCount}台は配置図の「位置未設定」から置いてください` : ""}`;
      const ok = await mutate(
        {
          action: kind === "employee" ? "importEmployees" : "importVehicles",
          items,
        },
        message,
      );
      if (ok) {
        setImportOpen(false);
        setImportRows([]);
        setImportSpots({});
        setImportError("");
        setImportFileName("");
      }
    } finally {
      setSubmitting(false);
    }
  };
  const persistEmployee = async () => {
    if (duplicateNfc || employeeCodeInvalid || submitting) return;
    setSubmitting(true);
    try {
      const body = editingEmployee
        ? {
            action: "updateEmployee",
            id: editingEmployee.id,
            version: editingEmployee.version,
            code: normalizeRecordCode(employeeForm.code),
            name: employeeForm.name,
            email: employeeForm.email,
            department: employeeForm.department,
            nfcUid: employeeForm.nfcUid,
          }
        : {
            action: "createEmployee",
            ...employeeForm,
            code: normalizeRecordCode(employeeForm.code),
          };
      const ok = await mutate(body, editingEmployee ? "社員情報を修正しました" : "社員を登録しました");
      if (ok) {
        if (editingEmployee) setHighlightId(editingEmployee.id);
        closeDrawer(true);
      }
    } finally {
      setSubmitting(false);
    }
  };
  const submitEmployee = (event: React.FormEvent) => {
    event.preventDefault();
    void persistEmployee();
  };
  const persistEmployeeNfc = async () => {
    if (!nfcEmployee || nfcEmployeeDuplicate || sameNfcUid(nfcEmployee.nfcUid, nfcEmployeeValue) || submitting) return;
    setSubmitting(true);
    try {
      const ok = await mutate(
        {
          action: "updateEmployeeNfc",
          id: nfcEmployee.id,
          version: nfcEmployee.version,
          nfcUid: nfcEmployeeValue,
        },
        nfcEmployeeValue ? (nfcEmployee.nfcUid ? "NFCカードを変更しました" : "NFCカードを登録しました") : "NFCカードの登録を解除しました",
      );
      if (ok) {
        setHighlightId(nfcEmployee.id);
        closeEmployeeNfc(true);
      }
    } finally {
      setSubmitting(false);
    }
  };
  const persistVehicle = async () => {
    if (duplicateNfc || vehicleCodeInvalid || submitting) return;
    setSubmitting(true);
    try {
      const body = editingVehicle
        ? {
            action: "updateVehicle",
            id: editingVehicle.id,
            version: editingVehicle.version,
            code: normalizeRecordCode(vehicleForm.code),
            name: vehicleForm.name,
            plateNumber: vehicleForm.plateNumber,
            nfcUid: vehicleForm.nfcUid,
            color: vehicleForm.color,
            hasEtc: vehicleForm.hasEtc,
            hasNavigation: vehicleForm.hasNavigation,
            hasWinterTires: vehicleForm.hasWinterTires,
            hasBackMonitor: vehicleForm.hasBackMonitor,
            isKei: vehicleForm.isKei,
            fuelCard: vehicleForm.fuelCard,
          }
        : {
            action: "createVehicle",
            ...vehicleForm,
            code: normalizeRecordCode(vehicleForm.code),
          };
      const ok = await mutate(body, editingVehicle ? "車両情報を修正しました" : "車両を登録しました");
      if (ok) {
        if (editingVehicle) setHighlightId(editingVehicle.id);
        closeDrawer(true);
      }
    } finally {
      setSubmitting(false);
    }
  };
  const submitVehicle = (event: React.FormEvent) => {
    event.preventDefault();
    void persistVehicle();
  };
  const persistVehicleNfc = async () => {
    if (!nfcVehicle || nfcVehicleDuplicate || sameNfcUid(nfcVehicle.nfcUid, nfcVehicleValue) || submitting) return;
    setSubmitting(true);
    try {
      const ok = await mutate(
        {
          action: "updateVehicleNfc",
          id: nfcVehicle.id,
          version: nfcVehicle.version,
          nfcUid: nfcVehicleValue,
        },
        nfcVehicleValue ? (nfcVehicle.nfcUid ? "NFCタグを変更しました" : "NFCタグを登録しました") : "NFCタグの登録を解除しました",
      );
      if (ok) {
        setHighlightId(nfcVehicle.id);
        closeVehicleNfc(true);
      }
    } finally {
      setSubmitting(false);
    }
  };
  const applyNfcChange = async () => {
    if (!nfcChangeConfirm || submitting) return;
    const targetKind = nfcChangeConfirm.kind;
    setNfcChangeConfirm(null);
    if (targetKind === "employee" && nfcEmployee) await persistEmployeeNfc();
    else if (targetKind === "employee") await persistEmployee();
    else if (nfcVehicle) await persistVehicleNfc();
    else await persistVehicle();
  };
  const applyActiveChange = async () => {
    if (!confirmTarget || submitting) return;
    setSubmitting(true);
    try {
      const action = kind === "employee" ? "setEmployeeActive" : "setVehicleActive";
      const ok = await mutate(
        {
          action,
          id: confirmTarget.id,
          version: confirmTarget.version,
          active: !confirmTarget.active,
        },
        confirmTarget.active ? `${confirmTarget.name}の利用を停止しました` : `${confirmTarget.name}の利用を再開しました${freeHoldingCount ? "。仮置き区画に置きました" : "。仮置きが空いていないため位置未設定です"}`,
      );
      if (ok) {
        setHighlightId(confirmTarget.id);
        setConfirmTarget(null);
        closeDrawer(true);
      }
    } finally {
      setSubmitting(false);
    }
  };
  // 一覧が再取得されても最新の版数で操作できるよう、対象はIDで持つ。
  const maintenanceVehicle = maintenanceVehicleId ? (data.vehicles.find((vehicle) => vehicle.id === maintenanceVehicleId) ?? null) : null;

  const total = kind === "employee" ? data.employees.length : data.vehicles.length;
  const active = kind === "employee" ? data.employees.filter((person) => person.active).length : data.vehicles.filter((vehicle) => vehicle.active).length;
  const emailReady = kind === "employee" ? data.employees.filter((person) => person.active && person.email).length : 0;
  const shown = kind === "employee" ? employees.length : vehicles.length;
  const pageCount = Math.max(1, Math.ceil(shown / pageSize));
  const currentPage = Math.min(page, pageCount);
  const rangeStart = shown === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd = Math.min(currentPage * pageSize, shown);
  const visibleEmployees = employees.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const visibleVehicles = vehicles.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <>
      <div className={cn("w-full space-y-5", kind === "employee" ? "max-w-[1080px]" : "max-w-[1280px]")}>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs text-slate-500 shadow-sm">
        <span>
          <b className="text-slate-800">FleetFlow {data.system.appVersion}</b> ・ {data.system.environment === "production" ? "本番環境" : "開発環境"}
        </span>
        <span>
          DB {data.system.schemaVersion} ・ 更新 {data.system.deployedAt ? new Date(data.system.deployedAt).toLocaleString("ja-JP") : "未確認"} ・ バックアップ確認 {data.system.backupVerifiedAt ? new Date(data.system.backupVerifiedAt).toLocaleString("ja-JP") : "未確認"}
        </span>
      </div>
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input aria-label={`${kind === "employee" ? "社員" : "車両"}を検索`} className={cn(field, "pl-9")} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={kind === "employee" ? "社員番号・氏名・メール・部署・NFC UIDで検索" : "車両番号・車両名・ナンバー・ガソリンカード・NFC UIDで検索"} />
          </div>
          <div className="flex flex-wrap gap-2">
            <select aria-label="状態で絞り込み" className={cn(field, "w-auto min-w-28")} value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}>
              <option value="active">有効</option>
              <option value="inactive">利用停止中</option>
              <option value="all">すべて</option>
              {kind === "vehicle" ? (
                <>
                  <option value="inUse">利用中</option>
                  <option value="maintenance">整備中</option>
                </>
              ) : null}
            </select>
            <select aria-label="NFCで絞り込み" className={cn(field, "w-auto min-w-28")} value={nfc} onChange={(event) => setNfc(event.target.value as NfcFilter)}>
              <option value="all">NFCすべて</option>
              <option value="unregistered">NFC未登録</option>
              <option value="registered">NFC登録済み</option>
            </select>
            {kind === "employee" ? (
              <select aria-label="メールで絞り込み" className={cn(field, "w-auto min-w-32")} value={email} onChange={(event) => setEmail(event.target.value as EmailFilter)}>
                <option value="all">メールすべて</option>
                <option value="unregistered">メール未登録</option>
                <option value="registered">メール登録済み</option>
              </select>
            ) : null}
            {kind === "employee" ? (
              <select aria-label="部署で絞り込み" className={cn(field, "w-auto min-w-32")} value={department} onChange={(event) => setDepartment(event.target.value)}>
                <option value="all">すべての部署</option>
                {departments.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            ) : null}
            <Button variant="secondary" onClick={() => setNfcCheckOpen(true)}>
              <Nfc className="size-4" />
              NFCを確認
            </Button>
            {kind === "employee" ? (
              <Button variant="secondary" onClick={() => setMailOpen(true)}>
                <Mail className="size-4" />
                QRメール {emailReady}/{active}人
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              <FileJson className="size-4" />
              JSON取込
            </Button>
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              {kind === "employee" ? "社員を追加" : "車両を追加"}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-4 py-3 text-xs text-slate-500">
          <span>
            <b className="text-slate-900">{rangeStart}–{rangeEnd}</b> / {shown}件
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <span>
              有効 {active} / 全{total}
              {kind === "employee" ? "人" : "台"}
            </span>
            {status === "active" && total > active ? (
              <button type="button" onClick={() => setStatus("inactive")} className="rounded-md px-1.5 py-0.5 font-bold text-blue-700 underline decoration-blue-200 underline-offset-4 hover:bg-blue-50">
                利用停止中の{total - active}
                {kind === "employee" ? "人" : "台"}を表示
              </button>
            ) : null}
            {shown > DEFAULT_PAGE_SIZE ? (
              <label className="ml-1 inline-flex items-center gap-1.5 whitespace-nowrap">
                <span>表示件数</span>
                <select aria-label="1ページの表示件数" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value) as PageSize)} className="min-h-8 rounded-lg border border-slate-200 bg-white px-2 font-bold text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100">
                  {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}件</option>)}
                </select>
              </label>
            ) : null}
          </span>
        </div>
        {shown === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-slate-400">条件に一致する{kind === "employee" ? "社員" : "車両"}がありません</p>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setStatus("active");
                setDepartment("all");
                setNfc("all");
                setEmail("all");
              }}
              className="mt-3 rounded-lg px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50"
            >
              検索条件をクリア
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {kind === "employee" ? (
              <div className={cn(employeeGrid, "hidden py-2 text-[11px] font-bold text-slate-400 md:grid")} aria-hidden="true">
                <span>社員番号</span>
                <span>氏名</span>
                <span className="hidden xl:block">メールアドレス</span>
                <span>部署</span>
                <span>NFC UID</span>
                <span>操作</span>
              </div>
            ) : null}
            {kind === "employee" ? (
              visibleEmployees.map((person) => (
                <div key={person.id} className={cn(employeeGrid, "py-2.5 transition [content-visibility:auto] hover:bg-slate-50/70", !person.active && "bg-slate-50 text-slate-500", highlightId === person.id && "bg-amber-50 ring-2 ring-inset ring-amber-300")}>
                  <span className="w-fit rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-bold text-slate-700">{person.code}</span>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <p className="truncate text-sm font-black">{person.name}</p>
                      {!person.active ? <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600">利用停止中</span> : null}
                    </div>
                    {person.email ? <p title={person.email} className="truncate text-[11px] text-slate-400 xl:hidden">{person.email}</p> : <span className="mt-0.5 inline-flex w-fit rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 xl:hidden">メール未登録</span>}
                    <p className="truncate text-xs text-slate-400 md:hidden">
                      {person.department} ・ <span className={person.nfcUid ? undefined : "font-bold text-amber-600"}>{nfcUidLabel(person.nfcUid)}</span>
                    </p>
                  </div>
                  <p className="hidden min-w-0 truncate text-xs text-slate-500 xl:block" title={person.email || "メール未登録"}>
                    {person.email || <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">メール未登録</span>}
                  </p>
                  <p className="hidden truncate text-xs font-bold text-slate-600 md:block">{person.department}</p>
                  <p className="hidden min-w-0 md:block">
                    {!person.active ? (
                      <span className="block truncate text-[11px] text-slate-400">
                        {person.nfcUid ? (
                          <>
                            <span className="font-mono line-through">{person.nfcUid}</span>
                            （割当解除済み）
                          </>
                        ) : (
                          "NFCなし"
                        )}
                      </span>
                    ) : person.nfcUid ? (
                      <span className="block truncate font-mono text-[11px] text-slate-500">{person.nfcUid}</span>
                    ) : (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">NFC未登録</span>
                    )}
                  </p>
                  <RowActions
                    active={person.active}
                    name={person.name}
                    nfcRegistered={!!person.nfcUid}
                    nfcMedium="カード"
                    onNfc={() => openEmployeeNfc(person)}
                    onQr={() =>
                      setQrPreview({
                        kind: "employee",
                        id: person.id,
                        code: person.code,
                        name: person.name,
                        email: person.email,
                        version: person.version,
                      })
                    }
                    onEdit={() => openEmployee(person)}
                    onResume={() =>
                      setConfirmTarget({
                        id: person.id,
                        name: person.name,
                        active: person.active,
                        version: person.version,
                      })
                    }
                  />
                </div>
              ))
            ) : (
              <div className={cn(vehicleGrid, "hidden py-2 text-[11px] font-bold text-slate-400 xl:grid")} aria-hidden="true">
                <span>車両番号</span>
                <span>車両名</span>
                <span>ナンバー</span>
                <span>ガソリンカード</span>
                <span>NFC UID</span>
                <span>状態・駐車位置</span>
                <span>操作</span>
              </div>
            )}
            {kind === "vehicle"
              ? visibleVehicles.map((vehicle) => (
                  <div key={vehicle.id} className={cn(vehicleGrid, "py-2.5 transition [content-visibility:auto] hover:bg-slate-50/70", !vehicle.active && "bg-slate-50 text-slate-500", vehicle.status === "MAINTENANCE" && "bg-amber-50/60", highlightId === vehicle.id && "bg-amber-50 ring-2 ring-inset ring-amber-300")}>
                    <span className="flex items-center gap-2">
                      <span className="hidden size-8 shrink-0 place-items-center rounded-lg bg-slate-100 sm:grid">
                        <CarFront className="size-4" style={vehicleIconStyle(vehicle.color)} />
                      </span>
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-bold text-slate-700">{vehicle.code}</span>
                    </span>
                    <div className="min-w-0">
                      {/* 装備バッジは名前の下に置き、横に並べて車両名が切れないようにする。 */}
                      <p className="truncate text-sm font-black" title={vehicle.name}>{vehicle.name}</p>
                      <EquipmentBadges vehicle={vehicle} className="mt-1 hidden xl:flex" />
                      <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1 xl:hidden">
                        <VehicleStatusBadge vehicle={vehicle} offSite={activeMaintenanceOf(data, vehicle.id)?.kind === "OFF_SITE"} />
                        <VehicleLocation vehicle={vehicle} spots={data.spots} offSite={activeMaintenanceOf(data, vehicle.id)?.kind === "OFF_SITE"} />
                        <EquipmentBadges vehicle={vehicle} />
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-400 xl:hidden">
                        {vehicle.plateNumber}
                        {vehicle.fuelCard ? ` ・ ${vehicle.fuelCard}` : ""} ・ <span className={vehicle.nfcUid ? undefined : "font-bold text-amber-600"}>{nfcUidLabel(vehicle.nfcUid)}</span>
                      </p>
                    </div>
                    <p className="hidden truncate text-xs font-bold text-slate-600 xl:block">{vehicle.plateNumber}</p>
                    <p className={cn("hidden truncate text-xs xl:block", vehicle.fuelCard ? "text-slate-600" : "text-slate-300")} title={vehicle.fuelCard || undefined}>{vehicle.fuelCard || "未登録"}</p>
                    <p className="hidden min-w-0 xl:block">
                      {!vehicle.active ? (
                        <span className="block truncate text-[11px] text-slate-400">
                          {vehicle.nfcUid ? (
                            <>
                              <span className="font-mono line-through">{vehicle.nfcUid}</span>
                              （割当解除済み）
                            </>
                          ) : (
                            "NFCなし"
                          )}
                        </span>
                      ) : vehicle.nfcUid ? (
                        <span className="block truncate font-mono text-[11px] text-slate-500">{vehicle.nfcUid}</span>
                      ) : (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">NFC未登録</span>
                      )}
                    </p>
                    <span className="hidden min-w-0 flex-wrap items-center gap-1.5 xl:flex">
                      <VehicleStatusBadge vehicle={vehicle} offSite={activeMaintenanceOf(data, vehicle.id)?.kind === "OFF_SITE"} />
                      <VehicleLocation vehicle={vehicle} spots={data.spots} offSite={activeMaintenanceOf(data, vehicle.id)?.kind === "OFF_SITE"} />
                    </span>
                    <RowActions
                      active={vehicle.active}
                      name={vehicle.name}
                      nfcRegistered={!!vehicle.nfcUid}
                      onNfc={() => openVehicleNfc(vehicle)}
                      onQr={() =>
                        setQrPreview({
                          kind: "vehicle",
                          id: vehicle.id,
                          code: vehicle.code,
                          name: vehicle.name,
                          version: vehicle.version,
                        })
                      }
                      maintenance={vehicle.status === "MAINTENANCE"}
                      maintenanceScheduled={data.maintenances.some((item) => item.vehicleId === vehicle.id && item.status === "SCHEDULED")}
                      maintenanceDisabled={!vehicle.active}
                      onEdit={() => openVehicle(vehicle)}
                      onResume={() =>
                        setConfirmTarget({
                          id: vehicle.id,
                          name: vehicle.name,
                          active: vehicle.active,
                          version: vehicle.version,
                        })
                      }
                      onMaintenance={() => setMaintenanceVehicleId(vehicle.id)}
                    />
                  </div>
                ))
              : null}
          </div>
        )}
        {shown > pageSize ? (
          <div className="flex flex-wrap items-center justify-center gap-2 border-t border-slate-100 bg-slate-50 px-4 py-3">
            <button type="button" disabled={currentPage === 1} onClick={() => setPage(1)} className="min-h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 disabled:opacity-35">
              先頭
            </button>
            <button type="button" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="min-h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 disabled:opacity-35">
              前へ
            </button>
            <label className="inline-flex min-h-9 items-center gap-1.5 px-1 text-xs font-bold text-slate-600">
              <span className="sr-only">表示ページ</span>
              <select aria-label="表示ページ" value={currentPage} onChange={(event) => setPage(Number(event.target.value))} className="min-h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100">
                {Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => <option key={pageNumber} value={pageNumber}>{pageNumber}</option>)}
              </select>
              <span>/ {pageCount}ページ</span>
            </label>
            <button type="button" disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} className="min-h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 disabled:opacity-35">
              次へ
            </button>
            <button type="button" disabled={currentPage === pageCount} onClick={() => setPage(pageCount)} className="min-h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 disabled:opacity-35">
              末尾
            </button>
          </div>
        ) : null}
      </Card>
      </div>

      {nfcCheckOpen ? (
        <NfcCheckDialog
          data={data}
          kind={kind}
          onOpen={(owner) => {
            setNfcCheckOpen(false);
            if (owner.kind === "employee") openEmployee(owner.item);
            else openVehicle(owner.item);
          }}
          onClose={() => setNfcCheckOpen(false)}
        />
      ) : null}

      {qrPreview ? <QrPreviewDialog owner={qrPreview} mutate={mutate} onClose={() => setQrPreview(null)} /> : null}
      {mailOpen ? <QrMailDialog employees={data.employees} onClose={() => setMailOpen(false)} /> : null}

      {importOpen ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeImport();
          }}
        >
          <div role="dialog" aria-modal="true" aria-busy={submitting} aria-label={`${kind === "employee" ? "社員" : "車両"}JSON取込`} className="w-full max-w-2xl rounded-3xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-100 p-5">
              <div>
                <p className="text-xs font-bold text-blue-600">一括登録</p>
                <h2 className="mt-1 text-xl font-black">{kind === "employee" ? "社員情報" : "車両情報"}をJSONから取込</h2>
                <p className="mt-1 text-xs text-slate-500">最大500件。NFC UIDは省略でき、後から一覧のNFCボタンで登録できます。</p>
              </div>
              <button type="button" aria-label="閉じる" disabled={submitting} onClick={closeImport} className="grid size-10 place-items-center rounded-xl bg-slate-100 disabled:opacity-40">
                <X className="size-4" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <div className="flex flex-wrap gap-2">
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700">
                  <Upload className="size-4" />
                  JSONファイルを選択
                  <input type="file" accept="application/json,.json" disabled={submitting} className="sr-only" onChange={(event) => void readImportFile(event.target.files?.[0])} />
                </label>
                <Button type="button" variant="ghost" disabled={submitting} onClick={downloadTemplate}>
                  <Download className="size-4" />
                  ひな形を保存
                </Button>
              </div>
              {importFileName ? <p className="text-xs font-bold text-slate-600">選択中：{importFileName}</p> : null}
              {importError ? (
                <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">
                  {importError}
                </p>
              ) : null}
              {importRows.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800">
                    <span>
                      {importRows.length}
                      {kind === "employee" ? "人" : "台"}を登録できます
                    </span>
                    <Check className="size-5" />
                  </div>
                  {kind === "vehicle" ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-3">
                      <p className="mr-auto text-xs font-bold text-slate-600">
                        駐車区画 {importPlacedCount}台に割当・空き
                        {freeImportSpots.length}区画
                      </p>
                      <Button type="button" variant="ghost" disabled={submitting || importUnplacedCount === 0 || freeImportSpots.length <= importPlacedCount} onClick={assignImportSpots}>
                        <MapPin className="size-4" />
                        空き区画を順に割り当て
                      </Button>
                      {importPlacedCount ? (
                        <Button type="button" variant="ghost" disabled={submitting} onClick={() => setImportSpots({})}>
                          割り当てを外す
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                  {kind === "vehicle" && importUnplacedCount ? (
                    <p className="rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-800">
                      区画を選んでいない{importUnplacedCount}
                      台は位置未設定になります。登録後、配置図の「位置未設定」から駐車区画に置いてください。
                    </p>
                  ) : null}
                  <div className="max-h-64 overflow-auto rounded-xl border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600">
                        <tr>
                          <th className="p-2">番号</th>
                          <th className="p-2">名称</th>
                          <th className="p-2">{kind === "employee" ? "部署" : "ナンバー"}</th>
                          <th className="p-2">NFC UID</th>
                          {kind === "vehicle" ? <th className="p-2">駐車区画</th> : null}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(kind === "vehicle" ? importRows : importRows.slice(0, 20)).map((row, index) => {
                          const nfcUid = typeof row.nfcUid === "string" && row.nfcUid.trim() ? normalizeNfcUid(row.nfcUid) : "";
                          // 他の行で選んだ区画は候補から外し、同じ区画を二重に選べないようにする。
                          const takenByOthers = new Set(
                            Object.entries(importSpots)
                              .filter(([key, spotId]) => Number(key) !== index && spotId)
                              .map(([, spotId]) => spotId),
                          );
                          return (
                            <tr key={`${String(row.code)}-${index}`}>
                              <td className="p-2 font-bold">{String(row.code)}</td>
                              <td className="p-2">{String(row.name)}</td>
                              <td className="p-2">{String(kind === "employee" ? row.department : row.plateNumber)}</td>
                              <td className={cn("p-2 text-[10px]", nfcUid ? "font-mono" : "font-bold text-amber-600")}>{nfcUid || "未登録（後から追加）"}</td>
                              {kind === "vehicle" ? (
                                <td className="p-1.5">
                                  <select
                                    aria-label={`${String(row.name)}の駐車区画`}
                                    value={importSpots[index] ?? ""}
                                    disabled={submitting}
                                    onChange={(event) =>
                                      setImportSpots((current) => ({
                                        ...current,
                                        [index]: event.target.value,
                                      }))
                                    }
                                    className={cn("min-h-8 w-full min-w-24 rounded-lg border bg-white px-2 text-xs font-bold", importSpots[index] ? "border-blue-300 text-blue-800" : "border-slate-200 text-slate-500")}
                                  >
                                    <option value="">後で設定</option>
                                    {freeImportSpots
                                      .filter((spot) => !takenByOthers.has(spot.id))
                                      .map((spot) => (
                                        <option key={spot.id} value={spot.id}>
                                          {formatSpotLabel(spot)}
                                        </option>
                                      ))}
                                  </select>
                                </td>
                              ) : null}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {kind === "employee" && importRows.length > 20 ? <p className="text-center text-xs text-slate-500">先頭20件を表示しています</p> : null}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center">
                  <FileJson className="mx-auto size-8 text-slate-300" />
                  <p className="mt-2 text-sm font-bold text-slate-500">JSONファイルを選択してください</p>
                  <p className="mt-1 text-xs text-slate-400">配列、または {kind === "employee" ? "employees" : "vehicles"} 配列を含むJSONに対応</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-4">
                <Button type="button" variant="ghost" disabled={submitting} onClick={closeImport}>
                  キャンセル
                </Button>
                <Button type="button" disabled={submitting || importRows.length === 0} onClick={submitImport}>
                  {submitting ? "登録中…" : `${importRows.length}${kind === "employee" ? "人" : "台"}を登録`}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {drawerOpen ? (
        <div
          className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !submitting) closeDrawer();
          }}
        >
          <aside ref={drawerRef} role="dialog" aria-modal="true" aria-busy={submitting} aria-label={kind === "employee" ? "社員情報" : "車両情報"} className="ml-auto flex h-full w-full max-w-xl flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 p-5">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-xs font-bold text-blue-600">{editingEmployee || editingVehicle ? "編集" : "新規登録"}</p>
                  {hasUnsavedChanges && !submitting ? <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700">未保存</span> : null}
                  {submitting ? (
                    <span role="status" className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700">
                      保存中
                    </span>
                  ) : null}
                </div>
                <h2 className="mt-1 text-xl font-black">{kind === "employee" ? (editingEmployee ? "社員情報を編集" : "社員を追加") : editingVehicle ? "車両情報を編集" : "車両を追加"}</h2>
              </div>
              <button aria-label={submitting ? "保存中は閉じられません" : "閉じる"} disabled={submitting} onClick={() => closeDrawer()} className="grid size-10 place-items-center rounded-xl bg-slate-100 transition disabled:cursor-not-allowed disabled:opacity-40">
                <X className="size-4" />
              </button>
            </div>
            {kind === "employee" ? (
              <form className="flex flex-1 flex-col overflow-y-auto p-5" onSubmit={submitEmployee}>
                <fieldset disabled={submitting} className="flex min-h-0 min-w-0 flex-1 flex-col border-0 p-0">
                  <div className="space-y-4">
                    <Field label="社員番号">
                      <RecordCodeInput kind="employee" autoFocus={!editingEmployee} value={employeeForm.code} onChange={(code) => setEmployeeForm((current) => ({ ...current, code }))} placeholder="例：E007" />
                      {editingEmployee && normalizeRecordCode(employeeForm.code) !== editingEmployee.code ? <p className="mt-1 text-xs font-bold text-amber-700">変更すると、過去の利用履歴も新しい社員番号で表示されます</p> : null}
                    </Field>
                    <Field label="氏名">
                      <input
                        required
                        autoFocus={!!editingEmployee}
                        className={field}
                        value={employeeForm.name}
                        onChange={(event) =>
                          setEmployeeForm((current) => ({
                            ...current,
                            name: event.target.value,
                          }))
                        }
                        placeholder="例：山田 太郎"
                      />
                    </Field>
                    <Field label="社用メールアドレス（任意）">
                      <input type="email" autoComplete="email" className={field} value={employeeForm.email} onChange={(event) => setEmployeeForm((current) => ({ ...current, email: event.target.value }))} placeholder="例：yamada@example.jp" />
                      <p className="mt-1 text-xs text-slate-500">登録すると社員QRを個別または一括で配信できます。</p>
                    </Field>
                    <Field label="部署">
                      <select
                        required
                        className={field}
                        value={employeeForm.department}
                        onChange={(event) =>
                          setEmployeeForm((current) => ({
                            ...current,
                            department: event.target.value,
                          }))
                        }
                      >
                        <option value="">{selectableDepartments.length ? "部署を選択してください" : "部署が登録されていません"}</option>
                        {selectableDepartments.map((name) => (
                          <option key={name} value={name}>
                            {name}
                            {editingEmployee?.department === name && !data.departments.some((item) => item.name === name && item.active) ? "（利用停止中）" : ""}
                          </option>
                        ))}
                      </select>
                      <Link href="/settings/departments" className="mt-2 inline-flex min-h-9 items-center text-xs font-bold text-blue-700 underline decoration-blue-200 underline-offset-4">
                        {selectableDepartments.length ? "部署を管理" : "部署を追加する"}
                      </Link>
                    </Field>
                  </div>
                  <div className="mt-auto space-y-4 pt-6">
                    <Button type="submit" className="w-full" disabled={submitting || !!duplicateNfc || employeeCodeInvalid}>
                      {submitting ? "保存中…" : editingEmployee ? "変更を保存" : "社員を登録"}
                    </Button>
                    {editingEmployee ? (
                      <ActiveControl
                        kind="employee"
                        active={editingEmployee.active}
                        dirty={employeeDirty}
                        onClick={() =>
                          setConfirmTarget({
                            id: editingEmployee.id,
                            name: editingEmployee.name,
                            active: editingEmployee.active,
                            version: editingEmployee.version,
                          })
                        }
                      />
                    ) : null}
                  </div>
                </fieldset>
              </form>
            ) : (
              <form className="flex flex-1 flex-col overflow-y-auto p-5" onSubmit={submitVehicle}>
                <fieldset disabled={submitting} className="flex min-h-0 min-w-0 flex-1 flex-col border-0 p-0">
                  <div className="space-y-5">
                    <section className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div><h3 className="text-sm font-black">基本情報</h3><p className="mt-1 text-xs text-slate-500">車両を識別する番号・名称・ナンバーと、使うガソリンカードを管理します。</p></div>
                      <div className="mt-4 space-y-4">
                    <Field label="車両番号">
                      <RecordCodeInput kind="vehicle" autoFocus={!editingVehicle} value={vehicleForm.code} onChange={(code) => setVehicleForm((current) => ({ ...current, code }))} placeholder="例：C018" />
                      {editingVehicle && normalizeRecordCode(vehicleForm.code) !== editingVehicle.code ? <p className="mt-1 text-xs font-bold text-amber-700">変更すると、過去の利用履歴も新しい車両番号で表示されます</p> : null}
                    </Field>
                    <Field label="車両名">
                      <input
                        required
                        autoFocus={!!editingVehicle}
                        className={field}
                        value={vehicleForm.name}
                        onChange={(event) =>
                          setVehicleForm((current) => ({
                            ...current,
                            name: event.target.value,
                          }))
                        }
                        placeholder="例：営業車9"
                      />
                    </Field>
                    <Field label="ナンバー">
                      <input
                        required
                        className={field}
                        value={vehicleForm.plateNumber}
                        onChange={(event) =>
                          setVehicleForm((current) => ({
                            ...current,
                            plateNumber: event.target.value,
                          }))
                        }
                        placeholder="例：品川 500 あ 12-34"
                      />
                    </Field>
                    <Field label="ガソリンカード（任意）">
                      <input
                        className={field}
                        maxLength={FUEL_CARD_MAX}
                        value={vehicleForm.fuelCard}
                        onChange={(event) =>
                          setVehicleForm((current) => ({
                            ...current,
                            fuelCard: event.target.value,
                          }))
                        }
                        placeholder="例：出光 末尾1234"
                      />
                      <p className="mt-1 text-xs text-slate-500">カード番号は入力せず、会社名と末尾4桁など見分けられる名前だけ登録します。</p>
                    </Field>
                    {!editingVehicle ? (
                      <Field label="駐車位置">
                        <select
                          required
                          aria-label="登録時の駐車区画"
                          className={field}
                          value={vehicleForm.spotId}
                          onChange={(event) =>
                            setVehicleForm((current) => ({
                              ...current,
                              spotId: event.target.value,
                            }))
                          }
                        >
                          <option value="">駐車区画を選択してください</option>
                          <ParkingSpotOptions spots={data.spots} />
                        </select>
                        {data.spots.some((spot) => spot.id === vehicleForm.spotId && isCustomerSpot(spot)) ? <div className="mt-2"><CustomerSpotNotice spots={data.spots} vehicle={null} /></div> : null}
                        <p className="mt-1 text-xs text-slate-500">登録と同時に配置図へ表示します。場所が決まっていない場合は仮置き区画を選び、決まったら配置図の「位置変更」で移動してください。</p>
                      </Field>
                    ) : null}
                      </div>
                    </section>
                    <section className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div><h3 className="text-sm font-black">装備・表示</h3><p className="mt-1 text-xs text-slate-500">利用者が車両を選ぶときに表示する情報です。</p></div>
                      <div className="mt-4 space-y-4">
                    <Field label="車両装備">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <EquipmentToggle
                          checked={vehicleForm.hasEtc}
                          label="ETC付"
                          onChange={(checked) =>
                            setVehicleForm((current) => ({
                              ...current,
                              hasEtc: checked,
                            }))
                          }
                        />
                        <EquipmentToggle
                          checked={vehicleForm.hasNavigation}
                          label="ナビ付"
                          onChange={(checked) =>
                            setVehicleForm((current) => ({
                              ...current,
                              hasNavigation: checked,
                            }))
                          }
                        />
                        <EquipmentToggle
                          checked={vehicleForm.hasBackMonitor}
                          label="バックモニター付"
                          onChange={(checked) =>
                            setVehicleForm((current) => ({
                              ...current,
                              hasBackMonitor: checked,
                            }))
                          }
                        />
                        <EquipmentToggle
                          checked={vehicleForm.hasWinterTires}
                          label="スタッドレス装着中"
                          onChange={(checked) =>
                            setVehicleForm((current) => ({
                              ...current,
                              hasWinterTires: checked,
                            }))
                          }
                        />
                      </div>
                    </Field>
                    <Field label="車種">
                      <VehicleKindChoice isKei={vehicleForm.isKei} onChange={(isKei) => setVehicleForm((current) => ({ ...current, isKei }))} />
                    </Field>
                    <Field label="表示色">
                      <VehicleColorChoice color={vehicleForm.color} onChange={(color) => setVehicleForm((current) => ({ ...current, color }))} />
                    </Field>
                      </div>
                    </section>
                  </div>
                  <div className="mt-auto space-y-4 pt-6">
                    {editingVehicle ? (
                      <ActiveControl
                        kind="vehicle"
                        active={editingVehicle.active}
                        dirty={vehicleDirty}
                        blockedReason={editingVehicle.active && editingVehicle.status !== "AVAILABLE" ? (editingVehicle.status === "MAINTENANCE" ? "整備中の車両は、整備を解除してから利用停止できます" : "利用中・予約中の車両は利用停止できません") : editingVehicle.active && data.maintenances.some((item) => item.vehicleId === editingVehicle.id && item.status === "SCHEDULED") ? "整備予定がある車両は、予定を取り消してから利用停止できます" : undefined}
                        onClick={() =>
                          setConfirmTarget({
                            id: editingVehicle.id,
                            name: editingVehicle.name,
                            active: editingVehicle.active,
                            version: editingVehicle.version,
                          })
                        }
                      />
                    ) : null}
                    <div className="sticky -bottom-5 z-10 -mx-5 border-t border-slate-200 bg-white/95 px-5 pb-5 pt-4 backdrop-blur">
                      <Button type="submit" className="w-full" disabled={submitting || !!duplicateNfc || vehicleCodeInvalid}>
                        {submitting ? "保存中…" : editingVehicle ? "変更を保存" : "車両を登録"}
                      </Button>
                    </div>
                  </div>
                </fieldset>
              </form>
            )}
          </aside>
        </div>
      ) : null}

      {nfcEmployee ? (
        <div
          className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeEmployeeNfc();
          }}
        >
          <div data-focus-layer role="dialog" aria-modal="true" aria-busy={submitting} aria-label={`${nfcEmployee.name}のNFCカード管理`} className="w-full max-w-lg rounded-3xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-100 p-5">
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-500">{nfcEmployee.code}・{nfcEmployee.name}</p>
                <h2 className="mt-1 text-xl font-black">NFCカード{nfcEmployee.nfcUid ? "を変更" : "を登録"}</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">社員情報は変更せず、NFCカードだけを管理します。</p>
              </div>
              <button type="button" aria-label="閉じる" disabled={submitting} onClick={() => closeEmployeeNfc()} className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600 disabled:opacity-40">
                <X className="size-4" />
              </button>
            </div>
            <div className="p-5">
              <NfcField
                kind="employee"
                registered={!!nfcEmployee.nfcUid}
                originalValue={nfcEmployee.nfcUid}
                value={nfcEmployeeValue}
                scanning={scanning}
                duplicate={nfcEmployeeDuplicate?.name}
                onScan={beginNfcScan}
                onChange={setNfcEmployeeValue}
                onDone={() => setScanning(false)}
              />
              <div className="mt-5 grid grid-cols-2 gap-2">
                <Button type="button" variant="ghost" disabled={submitting} onClick={() => closeEmployeeNfc()}>キャンセル</Button>
                <Button
                  type="button"
                  disabled={submitting || scanning || !!nfcEmployeeDuplicate || sameNfcUid(nfcEmployee.nfcUid, nfcEmployeeValue)}
                  onClick={() => {
                    if (nfcEmployeeValue) void persistEmployeeNfc();
                    else setNfcChangeConfirm({ kind: "employee", previous: nfcEmployee.nfcUid, next: "" });
                  }}
                >
                  {submitting ? "保存中…" : nfcEmployeeValue ? (nfcEmployee.nfcUid ? "このカードへ変更" : "このカードを登録") : "解除内容を確認"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {nfcVehicle ? (
        <div
          className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeVehicleNfc();
          }}
        >
          <div data-focus-layer role="dialog" aria-modal="true" aria-busy={submitting} aria-label={`${nfcVehicle.name}のNFCタグ管理`} className="w-full max-w-lg rounded-3xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-100 p-5">
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-500">{nfcVehicle.code}・{nfcVehicle.name}</p>
                <h2 className="mt-1 text-xl font-black">NFCタグ{nfcVehicle.nfcUid ? "を変更" : "を登録"}</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">車両情報は変更せず、NFCタグだけを管理します。</p>
              </div>
              <button type="button" aria-label="閉じる" disabled={submitting} onClick={() => closeVehicleNfc()} className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600 disabled:opacity-40">
                <X className="size-4" />
              </button>
            </div>
            <div className="p-5">
              <NfcField
                kind="vehicle"
                registered={!!nfcVehicle.nfcUid}
                originalValue={nfcVehicle.nfcUid}
                value={nfcVehicleValue}
                scanning={scanning}
                duplicate={nfcVehicleDuplicate?.name}
                onScan={beginNfcScan}
                onChange={setNfcVehicleValue}
                onDone={() => setScanning(false)}
              />
              <div className="mt-5 grid grid-cols-2 gap-2">
                <Button type="button" variant="ghost" disabled={submitting} onClick={() => closeVehicleNfc()}>キャンセル</Button>
                <Button
                  type="button"
                  disabled={submitting || scanning || !!nfcVehicleDuplicate || sameNfcUid(nfcVehicle.nfcUid, nfcVehicleValue)}
                  onClick={() => {
                    if (nfcVehicleValue) void persistVehicleNfc();
                    else setNfcChangeConfirm({ kind: "vehicle", previous: nfcVehicle.nfcUid, next: "" });
                  }}
                >
                  {submitting ? "保存中…" : nfcVehicleValue ? (nfcVehicle.nfcUid ? "このタグへ変更" : "このタグを登録") : "解除内容を確認"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {confirmTarget ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <div role="alertdialog" aria-modal="true" aria-busy={submitting} className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
            <span className={cn("mx-auto grid size-12 place-items-center rounded-full", confirmTarget.active ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600")}>{confirmTarget.active ? <Power /> : <Check />}</span>
            <h2 className="mt-4 text-center text-lg font-black">
              {confirmTarget.name}の利用を
              {confirmTarget.active ? "停止" : "再開"}しますか？
            </h2>
            <ul className="mt-4 space-y-1.5 rounded-2xl bg-slate-50 p-4 text-xs text-slate-600">
              {activeChangeEffects(kind, confirmTarget.active).map((effect) => (
                <li key={effect} className="flex gap-2">
                  <span aria-hidden="true" className="text-slate-400">
                    ・
                  </span>
                  <span>{effect}</span>
                </li>
              ))}
            </ul>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Button autoFocus variant="ghost" disabled={submitting} onClick={() => setConfirmTarget(null)}>
                キャンセル
              </Button>
              <Button disabled={submitting} variant={confirmTarget.active ? "danger" : "primary"} onClick={applyActiveChange}>
                {submitting ? "処理中…" : confirmTarget.active ? "利用を停止" : "利用を再開"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      {nfcChangeConfirm ? (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <div role="alertdialog" aria-modal="true" aria-busy={submitting} className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
            <span className="mx-auto grid size-12 place-items-center rounded-full bg-blue-50 text-blue-700"><Nfc /></span>
            <h2 className="mt-4 text-center text-lg font-black">NFC{nfcChangeConfirm.previous ? nfcChangeConfirm.next ? "を変更" : "登録を解除" : "を登録"}しますか？</h2>
            <div className="mt-4 space-y-2 rounded-2xl bg-slate-50 p-4 text-xs">
              <p><span className="font-bold text-slate-500">現在</span><span className="ml-3 font-mono font-bold text-slate-800">{nfcChangeConfirm.previous || "登録なし"}</span></p>
              <p><span className="font-bold text-slate-500">変更後</span><span className="ml-3 font-mono font-bold text-blue-800">{nfcChangeConfirm.next || "登録なし"}</span></p>
            </div>
            <p className="mt-3 text-xs text-slate-600">{nfcChangeConfirm.previous ? nfcChangeConfirm.next ? `保存が完了すると現在の${nfcChangeConfirm.kind === "employee" ? "カード" : "タグ"}は自動的に解除され、新しい登録へ切り替わります。` : `保存が完了すると現在の${nfcChangeConfirm.kind === "employee" ? "カード" : "タグ"}は呼び出しに使えなくなります。` : "保存が完了すると、このNFCで呼び出せるようになります。"}</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Button autoFocus variant="ghost" disabled={submitting} onClick={() => setNfcChangeConfirm(null)}>戻る</Button>
              <Button disabled={submitting} variant={nfcChangeConfirm.next ? "primary" : "danger"} onClick={() => void applyNfcChange()}>{submitting ? "保存中…" : nfcChangeConfirm.previous ? nfcChangeConfirm.next ? "このNFCへ変更" : "登録を解除" : "このNFCを登録"}</Button>
            </div>
          </div>
        </div>
      ) : null}
      {maintenanceVehicle ? <MaintenanceDialog vehicle={maintenanceVehicle} data={data} mutate={mutate} fromSettings onClose={() => setMaintenanceVehicleId(null)} onDone={() => setHighlightId(maintenanceVehicle.id)} /> : null}
      {discardConfirm ? (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <div role="alertdialog" aria-modal="true" className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
            <span className="mx-auto grid size-12 place-items-center rounded-full bg-amber-50 text-amber-600">
              <X />
            </span>
            <h2 className="mt-4 text-center text-lg font-black">入力内容を破棄しますか？</h2>
            <p className="mt-2 text-center text-sm text-slate-500">保存していない変更があります。この操作は元に戻せません。</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Button autoFocus variant="ghost" onClick={() => setDiscardConfirm(false)}>
                編集を続ける
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setDiscardConfirm(false);
                  closeDrawer(true);
                }}
              >
                破棄して閉じる
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

// 新規登録の車両はまだ専用区画の対象にならないため、専用区画は選択肢に出さない。
function ParkingSpotOptions({ spots, vehicleId }: { spots: ParkingSpot[]; vehicleId?: string }) {
  return (
    <>
      {spots
        .filter((spot) => spot.enabled && (!spot.vehicle || spot.vehicle.id === vehicleId) && canUseSpot({ id: vehicleId ?? "" }, spot))
        .map((spot) => (
          <option key={spot.id} value={spot.id}>
            {formatSpotLabel(spot)}
          </option>
        ))}
    </>
  );
}

// 駐車位置の変更は配置図で行う。一覧では位置を表示し、位置未設定の車両だけ配置図へ案内する。
function VehicleLocation({ vehicle, spots, offSite }: { vehicle: Vehicle; spots: ParkingSpot[]; offSite?: boolean }) {
  const current = spots.find((spot) => spot.id === vehicle.parkingSpotId);
  if (current)
    return (
      <span className="truncate text-xs font-bold text-slate-500">
        {formatSpotLabel(current)}
        {offSite ? "確保" : ""}
      </span>
    );
  if (vehicle.status === "IN_USE") return <span className="text-xs font-bold text-slate-500">出庫中</span>;
  if (offSite) return <span className="text-xs font-bold text-slate-500">外出中</span>;
  if (!vehicle.active) return null;
  if (vehicle.status !== "AVAILABLE") return <span className="text-xs font-bold text-amber-700">位置未設定</span>;
  return (
    <Link href={`/?placeVehicle=${encodeURIComponent(vehicle.id)}`} className="inline-flex min-h-7 items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2 text-xs font-bold text-amber-800 hover:border-amber-500">
      <MapPin className="size-3.5" />
      位置未設定・配置図で置く
    </Link>
  );
}

// 利用停止は誤操作を防ぐため編集画面に置き、一覧には停止中の行の「利用再開」だけを出す。
function RowActions({ active, name, maintenance, maintenanceScheduled, maintenanceDisabled, nfcRegistered, nfcMedium = "タグ", onQr, onNfc, onEdit, onResume, onMaintenance }: { active: boolean; name: string; maintenance?: boolean; maintenanceScheduled?: boolean; maintenanceDisabled?: boolean; nfcRegistered?: boolean; nfcMedium?: "カード" | "タグ"; onQr: () => void; onNfc?: () => void; onEdit: () => void; onResume: () => void; onMaintenance?: () => void }) {
  return (
    <div className="flex justify-end gap-2">
      {onMaintenance ? (
        <button type="button" disabled={maintenanceDisabled} onClick={onMaintenance} className={cn("relative inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-35", maintenance ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50" : "border-amber-200 text-amber-700 hover:bg-amber-50")} aria-label={`${name}の車検・故障${maintenance ? "（戻す・解除）" : maintenanceScheduled ? "（予定あり）" : ""}`}>
          <Wrench className="size-3.5" />
          <span className="hidden md:inline">{maintenance ? "戻す・解除" : "車検・故障"}</span>
          {maintenanceScheduled ? <span aria-hidden="true" className="absolute -right-1 -top-1 size-2.5 rounded-full bg-amber-500 ring-2 ring-white" /> : null}
        </button>
      ) : null}
      <button type="button" onClick={onQr} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-violet-200 px-3 text-xs font-bold text-violet-700 hover:bg-violet-50" aria-label={`${name}のQRコードを表示`}>
        <QrCode className="size-3.5" />
        <span className="hidden md:inline">QR</span>
      </button>
      {onNfc ? (
        <button type="button" disabled={!active} onClick={onNfc} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35" aria-label={`${name}のNFC${nfcMedium}を${nfcRegistered ? "変更" : "登録"}`}>
          <Nfc className="size-3.5" />
          <span className="hidden md:inline">NFC{nfcRegistered ? "変更" : "登録"}</span>
        </button>
      ) : null}
      <button type="button" onClick={onEdit} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 hover:bg-slate-50" aria-label={`${name}を編集`}>
        <Pencil className="size-3.5" />
        <span className="hidden md:inline">編集</span>
      </button>
      {!active ? (
        <button type="button" onClick={onResume} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-emerald-200 px-3 text-xs font-bold text-emerald-700 hover:bg-emerald-50" aria-label={`${name}の利用を再開`}>
          <Power className="size-3.5" />
          <span className="hidden md:inline">利用再開</span>
        </button>
      ) : null}
    </div>
  );
}

function QrPreviewDialog({
  owner,
  mutate,
  onClose,
}: {
  owner: {
    kind: "employee" | "vehicle";
    id: string;
    code: string;
    name: string;
    email?: string;
    version?: number;
  };
  mutate: Mutate;
  onClose: () => void;
}) {
  const [sending, setSending] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [rotated, setRotated] = useState(false);
  const [qrRevision, setQrRevision] = useState(0);
  const [message, setMessage] = useState("");
  const imageUrl = `/api/qr/${owner.kind}/${encodeURIComponent(owner.id)}?v=${owner.version ?? 0}-${qrRevision}`;
  const sendMail = async () => {
    setSending(true);
    setMessage("");
    try {
      const result = await sendQrMail([owner.id]);
      setMessage(result.failed ? "メールを送信できませんでした" : `${owner.email}へ送信しました`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "メールを送信できませんでした");
    } finally {
      setSending(false);
    }
  };
  const rotate = async () => {
    if (owner.version === undefined || rotated) return;
    setSending(true);
    try {
      const noun = owner.kind === "employee" ? "社員" : "車両";
      const ok = await mutate({ action: owner.kind === "employee" ? "rotateEmployeeQr" : "rotateVehicleQr", id: owner.id, version: owner.version }, `${noun}QRを再発行し、旧QRを無効化しました`);
      if (ok) {
        setQrRevision(Date.now());
        setConfirmRotate(false);
        setRotated(true);
      }
    } finally {
      setSending(false);
    }
  };
  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={`${owner.name}のQRコード`} className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl">
        <div className="flex items-start justify-between text-left">
          <div>
            <p className="text-xs font-bold text-violet-600">{owner.kind === "employee" ? "社員" : "車両"}QRコード</p>
            <h2 className="mt-1 text-xl font-black">
              {owner.code} {owner.name}
            </h2>
          </div>
          <button type="button" aria-label="閉じる" onClick={onClose} className="grid size-10 place-items-center rounded-xl bg-slate-100">
            <X className="size-4" />
          </button>
        </div>
        <img src={imageUrl} alt={`${owner.name}のFleetFlow用QRコード`} width={320} height={320} className="mx-auto mt-4 size-64 rounded-2xl border border-slate-200 bg-white p-2" />
        <p className="mt-3 text-xs text-slate-500">番号を変更してもこのQRコードは変わりません。複製物は識別用として同じ働きをします。</p>
        {owner.kind === "employee" ? (
          <div className="mt-4 space-y-2 text-left">
            {owner.email ? (
              <Button className="w-full" disabled={sending} onClick={() => void sendMail()}>
                <Send className="size-4" />
                {sending ? "送信中…" : `${owner.email}へ送信`}
              </Button>
            ) : (
              <p className="rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-800">メールアドレスが未登録です。社員編集から登録してください。</p>
            )}
            {message ? (
              <p role="status" className="rounded-xl bg-slate-50 p-3 text-xs font-bold text-slate-700">
                {message}
              </p>
            ) : null}
          </div>
        ) : null}
        {rotated ? (
          <div role="status" className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-left">
            <p className="text-xs font-black text-emerald-800">新しいQRへ切り替わりました</p>
            <p className="mt-1 text-xs leading-5 text-emerald-700">上のQRを保存・印刷して貼り替えてください。以前のQRは使用できません。</p>
          </div>
        ) : owner.version !== undefined ? (
          <details className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 text-left">
            <summary className="cursor-pointer px-4 py-3 text-xs font-bold text-slate-600">管理操作</summary>
            <div className="border-t border-slate-200 p-3">
              <p className="mb-3 text-xs leading-5 text-slate-500">紛失・破損・誤送信時だけ使用します。通常の表示・保存では再発行は不要です。</p>
              {!confirmRotate ? (
                <button type="button" disabled={sending} onClick={() => setConfirmRotate(true)} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white text-xs font-bold text-rose-700 hover:bg-rose-50">
                  <RotateCcw className="size-4" />
                  紛失・破損のため再発行
                </button>
              ) : (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                  <p className="text-xs font-bold text-rose-800">旧QRは直ちに使えなくなります。貼付済み・配布済みのQRもすべて無効になります。</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Button variant="ghost" disabled={sending} onClick={() => setConfirmRotate(false)}>戻る</Button>
                    <Button variant="danger" disabled={sending} onClick={() => void rotate()}>{sending ? "処理中…" : "再発行する"}</Button>
                  </div>
                </div>
              )}
            </div>
          </details>
        ) : null}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button variant="ghost" onClick={onClose}>
            閉じる
          </Button>
          <a href={imageUrl} download={`fleetflow-${owner.kind}-${owner.code}.svg`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-bold text-white hover:bg-violet-700">
            <Download className="size-4" />
            SVG保存
          </a>
        </div>
      </div>
    </div>
  );
}

async function sendQrMail(employeeIds: string[]) {
  const response = await fetch("/api/qr/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeIds }) });
  const result = (await response.json()) as { message?: string; sent?: number; failed?: number; failedEmployees?: { name: string }[] };
  if (!response.ok) throw new Error(result.message ?? "QRメールを送信できませんでした");
  return { sent: result.sent ?? 0, failed: result.failed ?? 0, failedEmployees: result.failedEmployees ?? [] };
}

function QrMailDialog({ employees, onClose }: { employees: Employee[]; onClose: () => void }) {
  const available = useMemo(() => employees.filter((employee) => employee.active && employee.email), [employees]);
  const missing = useMemo(() => employees.filter((employee) => employee.active && !employee.email), [employees]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(available.map((employee) => employee.id)));
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/qr/email")
      .then((response) => response.json())
      .then((result: { configured?: boolean }) => {
        if (active) setConfigured(result.configured === true);
      })
      .catch(() => {
        if (active) setConfigured(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const submit = async () => {
    if (!selected.size || sending) return;
    setSending(true);
    setMessage("");
    try {
      const result = await sendQrMail([...selected]);
      setMessage(result.failed ? `${result.sent}人へ送信、${result.failed}人は失敗しました：${result.failedEmployees.map((employee) => employee.name).join("、")}` : `${result.sent}人へQRメールを送信しました`);
      if (!result.failed) setSelected(new Set());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "QRメールを送信できませんでした");
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[75] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !sending) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="社員QRメール配信" className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-3xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 p-5">
          <div>
            <p className="text-xs font-bold text-violet-600">一括配信</p>
            <h2 className="mt-1 text-xl font-black">社員QRをメールで送信</h2>
            <p className="mt-1 text-xs text-slate-500">選択した社員へ、それぞれ本人用のQR画像を送信します。</p>
          </div>
          <button type="button" aria-label="閉じる" disabled={sending} onClick={onClose} className="grid size-10 place-items-center rounded-xl bg-slate-100 disabled:opacity-40">
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {configured === false ? (
            <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">
              SMTPが未設定です。READMEの「社員QRメール配信」を確認してください。
            </p>
          ) : null}
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-bold text-slate-600">
              送信対象 {selected.size} / {available.length}人
            </p>
            <button type="button" disabled={sending || !available.length} onClick={() => setSelected(available.length > 0 && selected.size === available.length ? new Set() : new Set(available.map((employee) => employee.id)))} className="min-h-9 rounded-lg px-3 text-xs font-bold text-blue-700 hover:bg-blue-50">
              {available.length > 0 && selected.size === available.length ? "すべて解除" : "すべて選択"}
            </button>
          </div>
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {available.map((employee) => (
              <label key={employee.id} className="flex min-h-12 cursor-pointer items-center gap-3 px-3 hover:bg-slate-50">
                <input
                  type="checkbox"
                  disabled={sending}
                  checked={selected.has(employee.id)}
                  onChange={() =>
                    setSelected((current) => {
                      const next = new Set(current);
                      next.has(employee.id) ? next.delete(employee.id) : next.add(employee.id);
                      return next;
                    })
                  }
                  className="size-4"
                />
                <span className="w-12 font-mono text-xs font-bold">{employee.code}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">{employee.name}</span>
                  <span className="block truncate text-xs text-slate-400">{employee.email}</span>
                </span>
              </label>
            ))}
          </div>
          {missing.length ? <p className="mt-3 text-xs text-amber-700">メール未登録のため対象外：{missing.map((employee) => employee.name).join("、")}</p> : null}
          {message ? (
            <p role="status" className="mt-3 rounded-xl bg-slate-50 p-3 text-sm font-bold text-slate-700">
              {message}
            </p>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-slate-100 p-5">
          <Button variant="ghost" disabled={sending} onClick={onClose}>
            閉じる
          </Button>
          <Button disabled={sending || configured !== true || selected.size === 0} onClick={() => void submit()}>
            <Send className="size-4" />
            {sending ? "送信中…" : `${selected.size}人へ送信`}
          </Button>
        </div>
      </div>
    </div>
  );
}

// 利用停止・再開でサーバー側が行う処理を、確認画面で利用者へ示す。
function activeChangeEffects(kind: "employee" | "vehicle", active: boolean) {
  const noun = kind === "employee" ? "社員" : "車両";
  const card = kind === "employee" ? "NFCカード" : "NFCタグ";
  return active ? [kind === "employee" ? "利用開始の選択肢から外れます" : "利用開始の選択肢と駐車場配置図から外れ、駐車位置の割り当ても外れます", `${card}の割り当てを解除します（別の${noun}に使えます）`, `${noun}番号は新しい${noun}に再利用できます`, "過去の利用履歴は残ります", "後から「利用再開」で戻せます"] : ["利用開始の選択肢に戻ります", `以前の${card}があれば再び割り当てます`, `${noun}番号や${card}が他で使用中の場合は再開できません`, ...(kind === "vehicle" ? ["駐車位置は再開後に車両一覧から設定してください"] : [])];
}

function ActiveControl({ kind, active, dirty, blockedReason, onClick }: { kind: "employee" | "vehicle"; active: boolean; dirty: boolean; blockedReason?: string; onClick: () => void }) {
  const noun = kind === "employee" ? "社員" : "車両";
  const reason = dirty ? "変更を保存するか取り消してから操作してください" : blockedReason;
  return (
    <div className={cn("rounded-2xl border p-4", active ? "border-rose-100 bg-rose-50/40" : "border-emerald-100 bg-emerald-50/40")}>
      <p className={cn("text-xs font-black", active ? "text-rose-700" : "text-emerald-700")}>{active ? "利用停止" : "利用再開"}</p>
      <p className="mt-1 text-xs text-slate-500">{active ? (kind === "employee" ? "退職・異動・長期休職などで使わなくなった社員を、利用開始の選択肢から外します。履歴は残ります。" : "売却・廃車・返却などで使わなくなった車両を、利用開始と配置図から外します。履歴は残ります。") : `この${noun}を再び利用開始の選択肢へ表示します。`}</p>
      {reason ? <p className="mt-2 text-xs font-bold text-amber-700">{reason}</p> : null}
      <button type="button" disabled={!!reason} onClick={onClick} className={cn("mt-3 inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg border bg-white px-3 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40", active ? "border-rose-200 text-rose-600 hover:bg-rose-50" : "border-emerald-200 text-emerald-700 hover:bg-emerald-50")}>
        <Power className="size-3.5" />
        {active ? `この${noun}の利用を停止` : `この${noun}の利用を再開`}
      </button>
    </div>
  );
}

function VehicleStatusBadge({ vehicle, offSite, className }: { vehicle: Pick<Vehicle, "active" | "status">; offSite?: boolean; className?: string }) {
  const label = !vehicle.active ? "利用停止中" : vehicle.status === "AVAILABLE" ? "利用可能" : vehicle.status === "IN_USE" ? "利用中" : vehicle.status === "MAINTENANCE" ? (offSite ? "車検で外出" : "整備中") : vehicle.status;
  return <span className={cn("inline-block w-fit shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold", !vehicle.active ? "bg-slate-200 text-slate-600" : vehicle.status === "AVAILABLE" ? "bg-emerald-50 text-emerald-700" : vehicle.status === "MAINTENANCE" ? "bg-amber-100 text-amber-800" : "bg-blue-50 text-blue-700", className)}>{label}</span>;
}

function EquipmentBadges({ vehicle, className }: { vehicle: Pick<Vehicle, "hasEtc" | "hasNavigation" | "hasBackMonitor" | "hasWinterTires" | "isKei">; className?: string }) {
  if (!vehicle.hasEtc && !vehicle.hasNavigation && !vehicle.hasBackMonitor && !vehicle.hasWinterTires && !vehicle.isKei) return null;
  return (
    <span className={cn("flex shrink-0 gap-1", className)} aria-label={`装備：${[vehicle.isKei ? "軽自動車" : "", vehicle.hasEtc ? "ETC" : "", vehicle.hasNavigation ? "ナビ" : "", vehicle.hasBackMonitor ? "バックモニター" : "", vehicle.hasWinterTires ? "冬タイヤ" : ""].filter(Boolean).join("、")}`}>
      {vehicle.isKei ? <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-[9px] font-black text-yellow-800">軽</span> : null}
      {vehicle.hasEtc ? <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[9px] font-black text-sky-700">ETC</span> : null}
      {vehicle.hasNavigation ? <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[9px] font-black text-violet-700">ナビ</span> : null}
      {vehicle.hasBackMonitor ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[9px] font-black text-emerald-700">バックモニター</span> : null}
      {vehicle.hasWinterTires ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-black text-slate-700">冬タイヤ</span> : null}
    </span>
  );
}

function VehicleColorChoice({ color, onChange }: { color: string; onChange: (color: string) => void }) {
  const presetName = vehicleColorName(color);
  const swatch = "size-6 shrink-0 rounded-full border border-slate-300";
  const choice = (selected: boolean) => cn("relative flex min-h-11 items-center gap-2 whitespace-nowrap rounded-xl border px-2.5 text-sm font-bold transition", selected ? "border-blue-500 bg-blue-50 text-blue-800 ring-1 ring-blue-500" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50");
  return (
    <div role="radiogroup" aria-label="車両の表示色" className="grid grid-cols-3 gap-2">
      {VEHICLE_COLORS.map((item) => {
        const selected = presetName === item.name;
        return (
          <button key={item.value} type="button" role="radio" aria-checked={selected} onClick={() => onChange(item.value)} className={choice(selected)}>
            <span className={cn(swatch, "grid place-items-center")} style={{ background: item.value }}>{selected ? <Check className={cn("size-3.5", isLightVehicleColor(item.value) ? "text-slate-900" : "text-white")} /> : null}</span>
            {item.name}
          </button>
        );
      })}
      <label className={cn(choice(!presetName), "cursor-pointer")}>
        <span className={cn(swatch, "relative overflow-hidden")} style={{ background: presetName ? "conic-gradient(#dc2626, #eab308, #15803d, #2563eb, #9333ea, #dc2626)" : color }}>
          <input type="color" aria-label="その他の表示色" value={color} onChange={(event) => onChange(event.target.value)} className="absolute inset-0 size-full cursor-pointer opacity-0" />
        </span>
        <span className="min-w-0">その他{presetName ? null : <span className="block text-[10px] font-semibold text-slate-500">{color.toUpperCase()}</span>}</span>
      </label>
    </div>
  );
}

function VehicleKindChoice({ isKei, onChange }: { isKei: boolean; onChange: (isKei: boolean) => void }) {
  return (
    <div role="radiogroup" aria-label="車種" className="grid grid-cols-2 gap-2">
      {[{ value: false, label: "普通車" }, { value: true, label: "軽自動車" }].map((option) => {
        const selected = option.value === isKei;
        return (
          <button key={option.label} type="button" role="radio" aria-checked={selected} onClick={() => onChange(option.value)} className={cn("flex min-h-12 items-center justify-center gap-1.5 rounded-xl border px-3 text-sm font-bold transition", selected ? "border-blue-500 bg-blue-600 text-white shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}>
            {selected ? <Check className="size-4" /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function EquipmentToggle({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <label className={cn("flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-bold transition", checked ? "border-blue-300 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-600")}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="size-5 accent-blue-600" />
      {label}
    </label>
  );
}

function NfcField({ kind, value, scanning, duplicate, onScan, onChange, onDone, registered = false, originalValue = "" }: { kind: "employee" | "vehicle"; registered?: boolean; originalValue?: string; value: string; scanning: boolean; duplicate?: string; onScan: () => void; onChange: (value: string) => void; onDone: () => void }) {
  const [timedOut, setTimedOut] = useState(false);
  const [readMessage, setReadMessage] = useState("");
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    if (!scanning) return;
    setTimedOut(false);
    const timer = window.setTimeout(() => {
      setTimedOut(true);
      onDoneRef.current();
    }, NFC_SCAN_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [scanning]);
  const bridgeStatus = useNfcBridge(scanning, (uid) => {
    setTimedOut(false);
    if (originalValue && sameNfcUid(uid, originalValue)) {
      onChange(originalValue);
      setReadMessage(`現在登録されている${kind === "employee" ? "カード" : "タグ"}です。変更はありません`);
    }
    else {
      onChange(uid);
      setReadMessage(`${kind === "employee" ? "カード" : "タグ"}を読み取りました。内容を確認して保存してください`);
    }
    onDone();
  });
  const statusText = nfcBridgeStatusText(bridgeStatus);
  // 社員はカード、車両はタグを使う。
  const medium = kind === "employee" ? "カード" : "タグ";
  const hasCurrent = registered || !!originalValue;
  const changed = !sameNfcUid(originalValue, value);
  const pendingRemoval = hasCurrent && changed && !value;
  const pendingRegistration = !hasCurrent && !!value;
  const pendingChange = hasCurrent && changed && !!value;
  const stateLabel = scanning ? "読取待機中" : duplicate ? "他で登録済み" : pendingRemoval ? "解除予定" : pendingChange ? "変更予定" : pendingRegistration ? "登録予定" : hasCurrent ? "登録済み" : "未登録";
  return (
    <div>
      <div className={cn("rounded-2xl border bg-white p-4 transition", scanning ? "border-blue-300 ring-4 ring-blue-50" : duplicate ? "border-rose-300" : timedOut || pendingRemoval || pendingChange || pendingRegistration ? "border-amber-300" : "border-slate-200")}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", scanning ? "bg-blue-50 text-blue-700" : duplicate ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600")}><Nfc className={cn("size-5", scanning && "animate-pulse")} /></span>
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2"><b className="text-sm">NFC{medium}</b><span className={cn("rounded-full px-2 py-0.5 text-[10px] font-black", duplicate ? "bg-rose-100 text-rose-700" : scanning ? "bg-blue-100 text-blue-700" : pendingRemoval || pendingChange || pendingRegistration ? "bg-amber-100 text-amber-800" : hasCurrent ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600")}>{stateLabel}</span></span>
              <span className="mt-1 block text-[11px] leading-5 text-slate-500">{scanning ? `新しい${medium}をリーダーにかざしてください` : hasCurrent ? `登録済みの${medium}でこの${kind === "employee" ? "社員" : "車両"}を呼び出せます` : `${medium}は後からでも登録できます`}</span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              if (scanning) onDone();
              else {
                setTimedOut(false);
                setReadMessage("");
                onScan();
              }
            }}
            className={cn("min-h-10 shrink-0 rounded-xl border px-3 text-xs font-bold transition", scanning ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50" : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100")}
          >
            {scanning ? "読み取りを中止" : timedOut ? "もう一度読み取る" : pendingChange || pendingRegistration ? `別の${medium}を読み直す` : hasCurrent ? `NFC${medium}を変更` : `NFC${medium}を登録`}
          </button>
        </div>
        {!scanning && !pendingChange && !pendingRegistration && !pendingRemoval ? <p className="mt-3 text-[10px] text-slate-500">読み取り後、画面下のボタンで内容を確認して確定します。</p> : null}
        {hasCurrent ? <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5"><span className="block text-[10px] font-bold text-slate-500">現在の登録</span><code className="mt-0.5 block break-all text-xs font-bold text-slate-800">{originalValue}</code></div> : null}
        {pendingChange || pendingRegistration ? <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5"><span className="block text-[10px] font-bold text-amber-700">保存後の登録</span><code className="mt-0.5 block break-all text-xs font-bold text-amber-950">{value}</code><p className="mt-1 text-[10px] text-amber-800">保存が完了するまで、現在の{medium}は引き続き使えます。</p></div> : null}
        {pendingRemoval ? <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-bold text-amber-900">保存するとNFC登録が解除されます。保存前なら取り消せます。</div> : null}
        {duplicate ? (
          <p className="mt-2 text-xs font-bold text-rose-600">このUIDは「{duplicate}」で登録済みです</p>
        ) : timedOut ? (
          <p role="status" className="mt-2 text-[11px] font-bold text-amber-800">
            15秒以内に読み取れませんでした。もう一度読み取るか、接続状態を確認してください。
          </p>
        ) : scanning ? (
          <p role="status" aria-live="polite" className={cn("mt-2 text-[11px]", bridgeStatus === "ready" ? "font-bold text-emerald-700" : bridgeStatus === "offline" ? "text-amber-700" : "text-blue-600")}>
            {statusText}
          </p>
        ) : readMessage ? <p role="status" className="mt-2 text-[11px] font-bold text-emerald-700">{readMessage}</p> : null}
        {scanning ? <NfcBridgeHelp status={bridgeStatus} className="mt-2" /> : null}
        {!scanning && pendingRemoval ? <button type="button" onClick={() => { setReadMessage(""); onChange(originalValue); }} className="mt-3 min-h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">解除を取り消す</button> : null}
        {!scanning && hasCurrent && !changed ? <button type="button" onClick={() => { setReadMessage("保存すると現在のNFC登録が解除されます"); onChange(""); }} className="mt-3 min-h-9 text-xs font-bold text-rose-700 underline decoration-rose-200 underline-offset-4 hover:text-rose-800">この{medium}の登録を解除</button> : null}
      </div>
    </div>
  );
}

type NfcOwner = { kind: "employee"; item: Employee } | { kind: "vehicle"; item: Vehicle };

// 手元のカード・タグがどの社員・車両のものかを確かめる。利用停止中で、再開すると戻る割り当ても出す。
function NfcCheckDialog({ data, kind, onOpen, onClose }: { data: DashboardData; kind: "employee" | "vehicle"; onOpen: (owner: NfcOwner) => void; onClose: () => void }) {
  const [scanning, setScanning] = useState(true);
  const [timedOut, setTimedOut] = useState(false);
  const [input, setInput] = useState("");
  const [uid, setUid] = useState("");
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!scanning) return;
    setTimedOut(false);
    const timer = window.setTimeout(() => {
      setTimedOut(true);
      setScanning(false);
    }, NFC_SCAN_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [scanning]);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);
  const bridgeStatus = useNfcBridge(scanning, (read) => {
    setInput(read);
    setUid(read);
    setScanning(false);
  });
  const check = () => {
    const next = normalizeNfcUid(input);
    setInput(next);
    setUid(next);
    setScanning(false);
  };
  // 有効な割り当てを先に出す。
  const owners = useMemo<NfcOwner[]>(() => (uid ? [...data.employees.filter((person) => sameNfcUid(person.nfcUid, uid)).map((item) => ({ kind: "employee" as const, item })), ...data.vehicles.filter((vehicle) => sameNfcUid(vehicle.nfcUid, uid)).map((item) => ({ kind: "vehicle" as const, item }))].sort((a, b) => Number(b.item.active) - Number(a.item.active)) : []), [data.employees, data.vehicles, uid]);
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="NFCを確認" className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 p-5">
          <div>
            <p className="text-xs font-bold text-blue-600">NFC確認</p>
            <h2 className="mt-1 text-xl font-black">手元のカード・タグを確認</h2>
            <p className="mt-1 text-xs text-slate-500">読み取ったUIDを割り当てている社員・車両を表示します。</p>
          </div>
          <button type="button" aria-label="閉じる" onClick={onClose} className="grid size-10 place-items-center rounded-xl bg-slate-100">
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <div className={cn("rounded-2xl border p-3", scanning ? "border-blue-300 bg-blue-50" : timedOut ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-slate-50")}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Nfc className={cn("size-5", scanning ? "animate-pulse text-blue-600" : timedOut ? "text-amber-600" : "text-slate-400")} />
                <span className="text-xs font-bold text-slate-600">{scanning ? "カード・タグをかざしてください" : timedOut ? "読み取りを確認できませんでした" : "NFCカード・タグ"}</span>
              </div>
              <button type="button" onClick={() => setScanning((current) => !current)} className={cn("shrink-0 rounded-lg bg-white px-3 py-1.5 text-xs font-bold shadow-sm", scanning ? "text-slate-600" : "text-blue-700")}>
                {scanning ? "読取を停止" : uid || timedOut ? "もう一度読み取る" : "NFC読取"}
              </button>
            </div>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                check();
              }}
            >
              <input aria-label="確認するNFC UID" className={cn(field, "font-mono")} value={input} onChange={(event) => setInput(event.target.value)} placeholder="UIDを入力または読み取り" />
              <Button type="submit" variant="secondary" disabled={!input.trim()} className="shrink-0">
                確認
              </Button>
            </form>
            {scanning ? (
              <p role="status" aria-live="polite" className={cn("mt-2 text-[11px]", bridgeStatus === "ready" ? "font-bold text-emerald-700" : bridgeStatus === "offline" ? "text-amber-700" : "text-blue-600")}>
                {nfcBridgeStatusText(bridgeStatus)}
              </p>
            ) : timedOut ? (
              <p role="status" className="mt-2 text-[11px] font-bold text-amber-800">
                15秒以内に読み取れませんでした。もう一度読み取るか、UIDを入力してください。
              </p>
            ) : null}
            {scanning ? <NfcBridgeHelp status={bridgeStatus} className="mt-2" /> : null}
          </div>
          {uid ? (
            <div role="status" aria-live="polite" className="space-y-2">
              <p className="text-xs font-bold text-slate-500">
                UID <span className="font-mono text-slate-800">{uid}</span>
              </p>
              {owners.length === 0 ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-black text-amber-800">どの社員・車両にも割り当てていません</p>
                  <p className="mt-1 text-xs text-amber-700">社員・車両の編集画面で、このUIDを登録できます。</p>
                </div>
              ) : (
                owners.map((owner) => {
                  const href = `/settings/${owner.kind === "employee" ? "employees" : "vehicles"}?q=${encodeURIComponent(owner.item.code)}${owner.item.active ? "" : "&status=inactive"}`;
                  const action = "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-blue-700 hover:bg-blue-50";
                  return (
                    <div key={owner.item.id} className={cn("flex items-center gap-3 rounded-2xl border p-3", owner.item.active ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-slate-50")}>
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white">{owner.kind === "employee" ? <UserRound className="size-5 text-slate-500" /> : <CarFront className="size-5" style={vehicleIconStyle(owner.item.color)} />}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-bold text-slate-500">
                          {owner.kind === "employee" ? "社員" : "車両"} <span className="font-mono">{owner.item.code}</span>
                        </p>
                        <p className="truncate text-sm font-black">
                          {owner.item.name}
                          <span className="ml-1.5 text-xs font-bold text-slate-500">{owner.kind === "employee" ? owner.item.department : owner.item.plateNumber}</span>
                        </p>
                        <p className={cn("mt-0.5 text-[11px] font-bold", owner.item.active ? "text-emerald-700" : "text-slate-500")}>{owner.item.active ? "割り当て中" : "利用停止中のため割り当て解除済み（再開すると戻ります）"}</p>
                      </div>
                      {owner.kind === kind ? (
                        <button type="button" onClick={() => onOpen(owner)} className={action}>
                          <Pencil className="size-3.5" />
                          編集
                        </button>
                      ) : (
                        <Link href={href} className={action}>
                          {owner.kind === "employee" ? "社員登録" : "車両登録"}
                          で開く
                        </Link>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// 英字1文字＋数字3桁以外は入力できないようにする。日本語入力の変換中は、確定してからそろえる。
function RecordCodeInput({ kind, value, onChange, autoFocus, placeholder }: { kind: "employee" | "vehicle"; value: string; onChange: (code: string) => void; autoFocus: boolean; placeholder: string }) {
  const [focused, setFocused] = useState(false);
  const incomplete = !!value && !isRecordCode(value) && !focused;
  return (
    <>
      <input
        required
        autoFocus={autoFocus}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={incomplete}
        className={cn(field, "font-mono uppercase", incomplete && "border-rose-300")}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange((event.nativeEvent as InputEvent).isComposing ? event.target.value : sanitizeRecordCodeInput(event.target.value))}
        onCompositionEnd={(event) => onChange(sanitizeRecordCodeInput(event.currentTarget.value))}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          onChange(sanitizeRecordCodeInput(value));
        }}
      />
      <span className={cn("mt-1 block text-xs", incomplete ? "font-bold text-rose-600" : "text-slate-500")}>{incomplete ? recordCodeMessage(kind) : `英字1文字＋数字3桁（例：${RECORD_CODE_EXAMPLES[kind]}）。小文字や全角は自動でそろえます`}</span>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold text-slate-600">{label}</span>
      {children}
    </label>
  );
}
