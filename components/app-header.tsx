"use client";

import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Archive, CarFront, Check, ChevronDown, ChevronUp, Clock3, Laptop, LayoutGrid, LoaderCircle, Nfc, QrCode, RefreshCw, Settings, UserRound, Users, Volume2, VolumeX, X } from "lucide-react";
import { reconnectScannerBridge, type NfcBridgeStatus, type QrBridgeStatus } from "@/lib/use-nfc-bridge";
import { isKioskDevice, setDeviceMode, setIdleTrafficEnabled, setNfcSoundEnabled, setUserTimeoutMinutes, useDeviceMode, useIdleTrafficEnabled, useNfcSoundEnabled, USER_TIMEOUT_CHOICES, useUserTimeoutMinutes, type DeviceMode } from "@/lib/device-mode";
import { playNfcSound } from "@/lib/nfc-sound";
import { NfcBridgeHelp } from "./nfc-bridge-help";
import { Button, cn } from "./ui";

export type AppView = "parking" | "timeline" | "settingsEmployees" | "settingsDepartments" | "settingsVehicles" | "settingsSpots" | "settingsData" | "operations";
export type HeaderSyncState = "loading" | "healthy" | "stale";

const jpTimeSeconds = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const jpClockDate = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "long", day: "numeric", weekday: "short" });
const jpClockTime = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false });

export function AppHeader({ view, actions }: { view: AppView; actions?: ReactNode }) {
  return <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
    <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3 px-4 py-3 md:px-8 2xl:gap-5">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid size-11 place-items-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-200"><CarFront /></div>
        <div className="min-w-0 overflow-hidden whitespace-nowrap max-[360px]:hidden"><h1 className="truncate text-lg font-black tracking-tight">FleetFlow</h1><HeaderClock /></div>
      </div>
      <Navigation view={view} className="hidden md:flex" />
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  </header>;
}

// どの画面でも今日の日付と現在時刻が分かるよう、ロゴの下に出す。分の切り替わりに遅れないよう10秒ごとに更新する。
function HeaderClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 10_000); return () => window.clearInterval(timer); }, []);
  return <time suppressHydrationWarning dateTime={now.toISOString()} className="block whitespace-nowrap text-xs text-slate-500">{jpClockDate.format(now)} <span className="tabular-nums">{jpClockTime.format(now)}</span></time>;
}

export function Navigation({ view, className }: { view: AppView; className?: string }) {
  const links: { id: "parking" | "timeline" | "settings" | "operations"; href: string; label: string; icon: ReactNode }[] = [
    { id: "parking", href: "/", label: "駐車場", icon: <LayoutGrid className="size-4" /> },
    { id: "timeline", href: "/timeline", label: "タイムライン", icon: <Clock3 className="size-4" /> },
    { id: "settings", href: "/settings/employees", label: "設定", icon: <Settings className="size-4" /> },
    { id: "operations", href: "/operations", label: "履歴", icon: <Archive className="size-4" /> },
  ];
  return <nav aria-label="メインメニュー" className={cn("items-center justify-center gap-1", className)}>{links.map((link) => {
    const active = link.id === "settings" ? view.startsWith("settings") : view === link.id;
    return <Link key={link.id} href={link.href} aria-current={active ? "page" : undefined} className={cn("flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 whitespace-nowrap rounded-xl px-1 text-[10px] font-bold transition md:min-h-10 md:flex-none md:flex-row md:gap-2 md:px-4 md:text-xs", active ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900")}>{link.icon}<span className="max-w-full truncate max-[300px]:hidden">{link.label}</span></Link>;
  })}</nav>;
}

export function HeaderSystemStatus({ syncState, lastSuccessfulSync, nfcStatus, qrStatus, refreshing, onRefresh, onOpenNfc }: { syncState: HeaderSyncState; lastSuccessfulSync: Date | null; nfcStatus: NfcBridgeStatus; qrStatus: QrBridgeStatus; refreshing: boolean; onRefresh: () => void; onOpenNfc: () => void }) {
  const [open, setOpen] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const panelId = useId();
  const appHealthy = syncState === "healthy";
  // 共用端末はNFCで使う前提なので、NFC Bridgeが止まったら「停止中」と出す。各自のPCは手動選択で使えるので「手動」とする。
  const kioskDevice = isKioskDevice(useDeviceMode(), nfcStatus === "ready" || qrStatus === "ready" ? "ready" : nfcStatus);
  const nfcLabel = nfcStatus === "ready" ? "NFC接続" : nfcStatus === "no-reader" ? "NFC未接続" : nfcStatus === "offline" ? kioskDevice ? "NFC停止中" : "NFC手動" : "NFC確認中";
  const nfcHealthy = nfcStatus === "ready";
  // リーダーが外れたとき、または共用端末でNFC Bridgeが止まったときは、ボタン自体を黄色にして気づけるようにする。
  const nfcWarning = nfcStatus === "no-reader" || (nfcStatus === "offline" && kioskDevice);
  const qrLabel = qrStatus === "ready" ? "QR接続" : qrStatus === "offline" ? "QR未接続" : "QR未設定";
  const scannerNeedsReconnect = nfcStatus === "offline" || nfcStatus === "no-reader" || qrStatus === "offline";
  const connectionNeedsReconnect = !appHealthy || scannerNeedsReconnect;
  const reconnect = async () => {
    if (reconnecting || refreshing) return;
    setReconnecting(true);
    if (scannerNeedsReconnect) await reconnectScannerBridge();
    if (!appHealthy) onRefresh();
    // Bridgeの終了→監視ランチャーによる再起動には通常5秒ほどかかる。
    window.setTimeout(() => setReconnecting(false), 7000);
  };
  return <div className="relative hidden lg:block">
    <button type="button" aria-expanded={open} aria-controls={panelId} aria-label={`システム ${appHealthy ? "正常" : "要確認"}、${nfcLabel}、${qrLabel}`} onClick={() => setOpen((current) => !current)} className={cn("flex items-center gap-1.5 rounded-xl border px-2.5 py-2 transition", nfcWarning || qrStatus === "offline" ? "border-amber-300 bg-amber-50 hover:bg-amber-100" : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white")} title="システム状態の詳細を表示"><span className={cn("size-2 rounded-full", appHealthy ? "bg-emerald-500" : "bg-rose-500")} /><span className={cn("text-xs font-bold", appHealthy ? "text-emerald-700" : "text-rose-700")}>{appHealthy ? "正常" : syncState === "loading" ? "確認中" : "更新停止"}</span><span className="text-slate-300">｜</span><Nfc className={cn("size-3.5", nfcHealthy ? "text-emerald-600" : "text-amber-600")} /><span aria-live="polite" className={cn("text-xs font-bold", nfcHealthy ? "text-emerald-700" : "text-amber-700")}>{nfcLabel}</span>{qrStatus !== "not-configured" ? <><span className="text-slate-300">｜</span><QrCode className={cn("size-3.5", qrStatus === "ready" ? "text-emerald-600" : "text-amber-600")} /><span className={cn("text-xs font-bold", qrStatus === "ready" ? "text-emerald-700" : "text-amber-700")}>{qrLabel}</span></> : null}{open ? <ChevronUp className="size-3.5 text-slate-400" /> : <ChevronDown className="size-3.5 text-slate-400" />}</button>
    {open ? <div id={panelId} role="status" className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-80 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl"><div className="flex items-start justify-between gap-3"><div><p className="font-black">システム状態</p><p className="mt-0.5 text-[11px] text-slate-500">運用に必要な接続をまとめて確認できます</p></div><button type="button" aria-label="システム状態を閉じる" onClick={() => setOpen(false)} className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="size-4" /></button></div><div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-100 bg-slate-50/60 px-3"><StatusRow label="FleetFlow本体" value={appHealthy ? "接続済み" : "更新停止"} healthy={appHealthy} /><StatusRow label="データベース" value={appHealthy ? "接続済み" : "確認が必要"} healthy={appHealthy} /><StatusRow label="NFCリーダー" value={nfcLabel} healthy={nfcHealthy} warning={!nfcHealthy} /><StatusRow label="QRスキャナ" value={qrLabel} healthy={qrStatus === "ready" || qrStatus === "not-configured"} warning={qrStatus === "offline"} /></div>{!nfcHealthy ? <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-black text-amber-900">NFCが使えない場合</p><NfcBridgeHelp status={nfcStatus} defaultOpen className="mt-2" /><button type="button" onClick={() => { setOpen(false); onOpenNfc(); }} className="mt-2 min-h-9 w-full rounded-lg bg-white px-3 text-xs font-bold text-amber-900 shadow-sm hover:bg-amber-100">手動選択・NFC読取を開く</button></div> : null}<p className="mt-3 text-xs text-slate-500">最終更新：{lastSuccessfulSync ? jpTimeSeconds.format(lastSuccessfulSync) : "確認中"}</p>{connectionNeedsReconnect ? <Button className="mt-3 w-full" variant="secondary" disabled={refreshing || reconnecting} onClick={() => void reconnect()}>{refreshing || reconnecting ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}{refreshing || reconnecting ? "再接続中…" : "再接続"}</Button> : null}</div> : null}
  </div>;
}

// 利用者を選んでいないとき、社員証をかざせる端末ではチップ自体で「かざす」ことを案内する。かざせない端末では手動選択だけを出す。
export function HeaderUserControl({ nfcStatus, nfcListening, employeeName, remainingSeconds = null, onPick, onClear }: { nfcStatus: NfcBridgeStatus; nfcListening: boolean; employeeName: string | null; remainingSeconds?: number | null; onPick: () => void; onClear: () => void }) {
  const canTap = nfcStatus === "ready" && nfcListening;
  // 共用端末では自動解除までの残り時間を出し、最後の30秒は色を変えて知らせる。
  const expiring = remainingSeconds !== null && remainingSeconds <= 30;
  return <>
    {employeeName ? <div className={cn("flex items-center overflow-hidden rounded-xl border transition-colors", expiring ? "border-amber-300 bg-amber-50" : "border-emerald-200 bg-emerald-50")}><button type="button" onClick={onPick} title={remainingSeconds !== null ? "利用者を変更（操作がないと自動で解除します）" : "利用者を変更"} className={cn("flex min-h-10 items-center gap-2 pl-2 pr-2.5 text-sm font-bold", expiring ? "text-amber-900 hover:bg-amber-100" : "text-emerald-900 hover:bg-emerald-100")}><span className={cn("grid size-6 shrink-0 place-items-center rounded-full bg-white", expiring ? "text-amber-700" : "text-emerald-700")}><UserRound className="size-3.5" /></span><span className="hidden max-w-32 truncate sm:inline">{employeeName}</span>{remainingSeconds !== null ? <span aria-label={`自動解除まで${Math.floor(remainingSeconds / 60)}分${remainingSeconds % 60}秒`} className={cn("rounded-md px-1.5 py-0.5 text-[11px] tabular-nums", expiring ? "animate-pulse bg-amber-200 font-black text-amber-900" : "bg-white/80 font-bold text-emerald-700")}>あと{Math.floor(remainingSeconds / 60)}:{String(remainingSeconds % 60).padStart(2, "0")}</span> : null}<ChevronDown className={cn("size-3.5 shrink-0", expiring ? "text-amber-600" : "text-emerald-600")} /></button><button type="button" onClick={onClear} aria-label="利用者選択を解除" title="利用者選択を解除" className={cn("grid min-h-10 w-9 place-items-center border-l", expiring ? "border-amber-300 text-amber-700 hover:bg-amber-100" : "border-emerald-200 text-emerald-700 hover:bg-emerald-100")}><X className="size-3.5" /></button></div>
      : <button type="button" onClick={onPick} aria-label={canTap ? "読取待機中。社員証をかざすか社員QRを読み取り、または押して一覧から選択" : "利用者を一覧から選ぶ"} title={canTap ? "社員証または社員QRで利用者を確認できます。押すと一覧から選べます" : "利用者を一覧から選ぶ"} className={cn("flex min-h-10 items-center gap-2 rounded-xl border border-dashed px-3 text-sm font-bold transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700", canTap ? "border-emerald-300 bg-emerald-50/60 text-emerald-800 ring-2 ring-emerald-100" : "border-slate-300 bg-white text-slate-600")}>{canTap ? <span className="relative grid size-4 place-items-center"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-300 opacity-60 motion-reduce:hidden" /><QrCode className="relative size-4" /></span> : <UserRound className="size-4" />}<span className="hidden sm:inline">{canTap ? "社員証・QR／選ぶ" : "利用者を選ぶ"}</span>{canTap ? <span className="hidden rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-black text-white xl:inline">待機中</span> : null}<ChevronDown className={cn("size-3.5", canTap ? "text-emerald-500" : "text-slate-400")} /></button>}
  </>;
}

const DEVICE_MODES: { mode: DeviceMode; label: string; description: string }[] = [
  { mode: "auto", label: "自動", description: "NFC・QR連携ソフトが動いていれば共用端末として使います" },
  { mode: "kiosk", label: "共用端末", description: "社員証で確認した人は、操作を終えると破棄します" },
  { mode: "personal", label: "各自のPC", description: "選んだ利用者をこの端末に残します" },
];

// この端末を共用端末・各自のPCのどちらとして使っているかを常に見せ、押すと切り替えられる。
// 共用端末から外すと前の人の名前が残るようになるため、そのときだけ確認する。
export function HeaderDeviceMode({ nfcStatus }: { nfcStatus: NfcBridgeStatus }) {
  const mode = useDeviceMode();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<DeviceMode | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const kiosk = isKioskDevice(mode, nfcStatus);
  const timeoutMinutes = useUserTimeoutMinutes();
  const soundEnabled = useNfcSoundEnabled();
  const idleTrafficEnabled = useIdleTrafficEnabled();

  useEffect(() => {
    if (!open) return;
    const close = () => { setOpen(false); setPending(null); };
    const onPointerDown = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) close(); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const apply = (next: DeviceMode) => { setDeviceMode(next); setPending(null); setOpen(false); };
  const choose = (next: DeviceMode) => {
    if (next === mode) { setOpen(false); return; }
    if (kiosk && !isKioskDevice(next, nfcStatus)) { setPending(next); return; }
    apply(next);
  };

  return <div ref={rootRef} className="relative">
    <button type="button" aria-expanded={open} aria-controls={menuId} onClick={() => { setOpen((current) => !current); setPending(null); }} title={mode === "auto" ? "この端末の使い方を切り替える（今はNFC Bridgeで自動判定）" : "この端末の使い方を切り替える"} className={cn("flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-xl border px-2.5 text-xs font-black transition", kiosk ? "border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100" : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-white")}>
      {kiosk ? <Users className="size-4" /> : <Laptop className="size-4" />}
      <span>{kiosk ? "共用端末" : "各自のPC"}</span>
      <ChevronDown className="size-3.5 opacity-60" />
    </button>
    {open ? <div id={menuId} className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-72 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">
      {pending ? <div role="alertdialog" aria-labelledby={`${menuId}-confirm`} className="p-2">
        <p id={`${menuId}-confirm`} className="text-sm font-black">共用端末から外しますか？</p>
        <p className="mt-1 text-xs text-slate-600">この端末に利用者の名前が残るようになります。入口の共用端末では、次の人が前の人の名前のまま操作するおそれがあります。</p>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" autoFocus onClick={() => setPending(null)} className="min-h-9 whitespace-nowrap rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">やめる</button>
          <button type="button" onClick={() => apply(pending)} className="min-h-9 whitespace-nowrap rounded-lg bg-amber-600 px-3 text-xs font-black text-white hover:bg-amber-700">「{DEVICE_MODES.find((item) => item.mode === pending)?.label}」にする</button>
        </div>
      </div> : <>
        <p className="px-2 pb-1.5 pt-1 text-[11px] font-bold text-slate-500">この端末の設定</p>
        <div role="radiogroup" aria-label="この端末の使い方">
        {DEVICE_MODES.map((item) => <button key={item.mode} type="button" role="radio" aria-checked={item.mode === mode} onClick={() => choose(item.mode)} className={cn("flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left transition", item.mode === mode ? "bg-blue-50" : "hover:bg-slate-50")}>
          <span className="mt-0.5 grid size-4 shrink-0 place-items-center">{item.mode === mode ? <Check className="size-4 text-blue-600" /> : null}</span>
          <span className="min-w-0"><span className="block text-sm font-black">{item.label}{item.mode === "auto" ? <span className="ml-1.5 text-[11px] font-bold text-slate-500">今は{isKioskDevice("auto", nfcStatus) ? "共用端末" : "各自のPC"}</span> : null}</span><span className="block text-[11px] text-slate-500">{item.description}</span></span>
        </button>)}
        </div>
        <div className="mt-1 space-y-2 border-t border-slate-100 px-2 pb-1 pt-2.5">
          {kiosk ? <div className="flex items-center justify-between gap-2"><span className="text-xs font-bold text-slate-600">自動解除まで</span><div role="radiogroup" aria-label="操作がないとき利用者を自動で解除するまでの時間" className="flex rounded-lg bg-slate-100 p-0.5">{USER_TIMEOUT_CHOICES.map((minutes) => <button key={minutes} type="button" role="radio" aria-checked={minutes === timeoutMinutes} onClick={() => setUserTimeoutMinutes(minutes)} className={cn("min-h-8 rounded-md px-2.5 text-xs font-bold transition", minutes === timeoutMinutes ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700")}>{minutes}分</button>)}</div></div> : null}
          <div className="flex items-center justify-between gap-2"><span className="text-xs font-bold text-slate-600">効果音</span><button type="button" role="switch" aria-checked={soundEnabled} aria-label="NFCを読み取ったときの効果音" onClick={() => { setNfcSoundEnabled(!soundEnabled); if (!soundEnabled) playNfcSound("success"); }} className={cn("flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-bold transition", soundEnabled ? "bg-blue-50 text-blue-700 hover:bg-blue-100" : "bg-slate-100 text-slate-500 hover:text-slate-700")}>{soundEnabled ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}{soundEnabled ? "オン" : "オフ"}</button></div>
          <div className="flex items-center justify-between gap-2"><span className="text-xs font-bold text-slate-600">待機中の演出</span><button type="button" role="switch" aria-checked={idleTrafficEnabled} aria-label="1時間操作がないとき配置図の道路に車を走らせる" title="1時間操作がないと、配置図の道路に車が走ります" onClick={() => setIdleTrafficEnabled(!idleTrafficEnabled)} className={cn("flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-bold transition", idleTrafficEnabled ? "bg-blue-50 text-blue-700 hover:bg-blue-100" : "bg-slate-100 text-slate-500 hover:text-slate-700")}><CarFront className="size-3.5" />{idleTrafficEnabled ? "オン" : "オフ"}</button></div>
        </div>
      </>}
    </div> : null}
  </div>;
}

function StatusRow({ label, value, healthy, warning = false }: { label: string; value: string; healthy: boolean; warning?: boolean }) {
  return <div className="flex items-center justify-between gap-3 py-2.5 text-xs"><span className="font-bold text-slate-600">{label}</span><span className={cn("flex items-center gap-1.5 font-black", healthy ? "text-emerald-700" : warning ? "text-amber-700" : "text-rose-700")}><i className={cn("size-2 rounded-full", healthy ? "bg-emerald-500" : warning ? "bg-amber-500" : "bg-rose-500")} />{value}</span></div>;
}
