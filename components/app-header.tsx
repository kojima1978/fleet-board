"use client";

import type { ReactNode } from "react";
import { useId, useState } from "react";
import Link from "next/link";
import { Archive, CarFront, ChevronDown, ChevronUp, Clock3, LayoutGrid, LoaderCircle, Nfc, RefreshCw, Settings, X } from "lucide-react";
import type { NfcBridgeStatus } from "@/lib/use-nfc-bridge";
import { Button, cn } from "./ui";

export type AppView = "parking" | "timeline" | "settingsEmployees" | "settingsVehicles" | "operations";
export type HeaderSyncState = "loading" | "healthy" | "stale";

const jpTimeSeconds = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export function AppHeader({ view, actions }: { view: AppView; actions?: ReactNode }) {
  return <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
    <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-5 px-4 py-3 md:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid size-11 place-items-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-200"><CarFront /></div>
        <div className="min-w-0 max-[360px]:hidden"><h1 className="text-lg font-black tracking-tight">FleetFlow</h1><p className="hidden text-xs text-slate-500 sm:block">社用車 利用・駐車管理</p></div>
      </div>
      <Navigation view={view} className="hidden md:flex" />
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  </header>;
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

export function HeaderSystemStatus({ syncState, lastSuccessfulSync, nfcStatus, refreshing, onRefresh, onOpenNfc, onDownloadDiagnostics }: { syncState: HeaderSyncState; lastSuccessfulSync: Date | null; nfcStatus: NfcBridgeStatus; refreshing: boolean; onRefresh: () => void; onOpenNfc: () => void; onDownloadDiagnostics: () => void }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const appHealthy = syncState === "healthy";
  const nfcLabel = nfcStatus === "ready" ? "NFC接続" : nfcStatus === "no-reader" ? "NFC未接続" : nfcStatus === "offline" ? "NFC手動" : "NFC確認中";
  const nfcHealthy = nfcStatus === "ready";
  return <div className="relative hidden lg:block">
    <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((current) => !current)} className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 transition hover:border-slate-300 hover:bg-white" title="システム状態の詳細を表示"><span className={cn("size-2 rounded-full", appHealthy ? "bg-emerald-500" : "bg-rose-500")} /><span className={cn("text-xs font-bold", appHealthy ? "text-emerald-700" : "text-rose-700")}>{appHealthy ? "正常" : syncState === "loading" ? "確認中" : "更新停止"}</span><span className="text-slate-300">｜</span><Nfc className={cn("size-3.5", nfcHealthy ? "text-emerald-600" : "text-amber-600")} /><span className={cn("text-xs font-bold", nfcHealthy ? "text-emerald-700" : "text-amber-700")}>{nfcLabel}</span>{open ? <ChevronUp className="size-3.5 text-slate-400" /> : <ChevronDown className="size-3.5 text-slate-400" />}</button>
    {open ? <div id={panelId} role="status" className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-80 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl"><div className="flex items-start justify-between gap-3"><div><p className="font-black">システム状態</p><p className="mt-0.5 text-[11px] text-slate-500">運用に必要な接続をまとめて確認できます</p></div><button type="button" aria-label="システム状態を閉じる" onClick={() => setOpen(false)} className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="size-4" /></button></div><div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-100 bg-slate-50/60 px-3"><StatusRow label="FleetFlow本体" value={appHealthy ? "接続済み" : "更新停止"} healthy={appHealthy} /><StatusRow label="データベース" value={appHealthy ? "接続済み" : "確認が必要"} healthy={appHealthy} /><StatusRow label="NFCリーダー" value={nfcLabel} healthy={nfcHealthy} warning={!nfcHealthy} /></div>{!nfcHealthy ? <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-black text-amber-900">NFCが使えない場合</p><p className="mt-1 text-[11px] leading-5 text-amber-800">連携ソフトとリーダーを確認してください。復旧するまでは手動選択で運用できます。</p><button type="button" onClick={() => { setOpen(false); onOpenNfc(); }} className="mt-2 min-h-9 w-full rounded-lg bg-white px-3 text-xs font-bold text-amber-900 shadow-sm hover:bg-amber-100">手動選択・NFC読取を開く</button></div> : null}<p className="mt-3 text-xs text-slate-500">最終更新：{lastSuccessfulSync ? jpTimeSeconds.format(lastSuccessfulSync) : "確認中"}</p><div className="mt-3 grid grid-cols-2 gap-2"><Button variant="secondary" disabled={refreshing} onClick={onRefresh}>{refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}{refreshing ? "確認中…" : "再確認"}</Button><Button variant="ghost" onClick={onDownloadDiagnostics}>診断を保存</Button></div></div> : null}
  </div>;
}

function StatusRow({ label, value, healthy, warning = false }: { label: string; value: string; healthy: boolean; warning?: boolean }) {
  return <div className="flex items-center justify-between gap-3 py-2.5 text-xs"><span className="font-bold text-slate-600">{label}</span><span className={cn("flex items-center gap-1.5 font-black", healthy ? "text-emerald-700" : warning ? "text-amber-700" : "text-rose-700")}><i className={cn("size-2 rounded-full", healthy ? "bg-emerald-500" : warning ? "bg-amber-500" : "bg-rose-500")} />{value}</span></div>;
}
