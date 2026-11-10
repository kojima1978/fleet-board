"use client";

import Link from "next/link";
import { AlertTriangle, Check, ChevronRight, Database, DatabaseBackup, Nfc, QrCode, Server, Sparkles } from "lucide-react";
import type { HeaderSyncState } from "./app-header";
import type { NfcBridgeStatus, QrBridgeStatus } from "@/lib/use-nfc-bridge";
import { setMinionAnimationEnabled, useMinionAnimationEnabled } from "@/lib/device-mode";
import { cn } from "./ui";

type SystemInfo = {
  backupLatestAt: string | null;
  backupVerifiedAt: string | null;
  appVersion: string;
  environment: string;
  deployedAt: string | null;
  schemaVersion: string;
};

const dateTime = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const DAY_MS = 26 * 60 * 60_000;

export function SystemStatusPanel({ system, syncState, nfcStatus, qrStatus }: { system: SystemInfo; syncState: HeaderSyncState; nfcStatus: NfcBridgeStatus; qrStatus: QrBridgeStatus }) {
  const minionAnimationEnabled = useMinionAnimationEnabled();
  const now = Date.now();
  const appHealthy = syncState === "healthy";
  const backupHealthy = Boolean(system.backupLatestAt) && now - new Date(system.backupLatestAt!).getTime() < DAY_MS;
  const verificationHealthy = Boolean(system.backupVerifiedAt) && now - new Date(system.backupVerifiedAt!).getTime() < DAY_MS;
  const backupDetail = system.backupLatestAt ? `最終 ${dateTime.format(new Date(system.backupLatestAt))}` : "バックアップを確認できません";
  const appDetail = system.environment === "production" ? `v${system.appVersion}・本番` : system.appVersion === "development" ? "開発環境" : `v${system.appVersion}・開発`;
  const nfcDetail = nfcStatus === "ready" ? "接続済み" : nfcStatus === "connecting" ? "確認中" : nfcStatus === "no-reader" ? "Bridge起動・機器未接続" : nfcStatus === "idle" ? "この端末では未使用" : "Bridge未接続";
  const qrDetail = qrStatus === "ready" ? "接続済み" : qrStatus === "not-configured" ? "未設定" : "未接続";

  return <div className="w-full max-w-[760px] space-y-4"><section aria-label="システム状態一覧" className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <StatusCard icon={<Server className="size-5" />} title="アプリ" detail={appDetail} tone={appHealthy ? "healthy" : "error"} />
      <StatusCard icon={<Database className="size-5" />} title="データベース" detail={appHealthy ? system.schemaVersion : "接続を確認してください"} tone={appHealthy ? "healthy" : "error"} />
      <StatusCard icon={<DatabaseBackup className="size-5" />} title="バックアップ" detail={backupDetail} subdetail={verificationHealthy ? "復元確認済み" : "復元確認が必要"} tone={backupHealthy && verificationHealthy ? "healthy" : "warning"} href="/settings/data" action="保存・復元" />
      <StatusCard icon={<Nfc className="size-5" />} title="NFCリーダー" detail={nfcDetail} tone={nfcStatus === "ready" || nfcStatus === "idle" ? "healthy" : "warning"} href="/settings/scanner" action="接続管理" />
      <StatusCard icon={<QrCode className="size-5" />} title="QRスキャナ" detail={qrDetail} tone={qrStatus === "ready" ? "healthy" : qrStatus === "not-configured" ? "neutral" : "warning"} href="/settings/scanner" action="接続管理" />
    </section><section aria-labelledby="display-settings-title" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-4 py-3 sm:px-5"><h3 id="display-settings-title" className="text-sm font-black text-slate-900">この端末の表示設定</h3><p className="mt-0.5 text-xs text-slate-500">端末の性能や設置場所に合わせて変更できます</p></div><div className="flex min-h-[72px] items-center gap-3 px-4 py-3 sm:px-5"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600"><Sparkles className="size-5" /></span><div className="mr-auto min-w-0"><p className="text-sm font-black text-slate-900">駐車場3Dアニメーション</p><p className="mt-0.5 text-xs text-slate-500">配置図の外周を走るキャラクターを表示します</p></div><button type="button" role="switch" aria-checked={minionAnimationEnabled} onClick={() => setMinionAnimationEnabled(!minionAnimationEnabled)} className={cn("flex min-h-9 w-24 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-2 text-xs font-bold transition", minionAnimationEnabled ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50")}><span className={cn("relative h-4 w-7 shrink-0 rounded-full", minionAnimationEnabled ? "bg-blue-600" : "bg-slate-200")}><span className={cn("absolute top-0.5 size-3 rounded-full bg-white shadow-sm transition", minionAnimationEnabled ? "left-[14px]" : "left-0.5")} /></span>{minionAnimationEnabled ? "表示" : "非表示"}</button></div></section></div>;
}

function StatusCard({ icon, title, detail, subdetail, tone, href, action }: { icon: React.ReactNode; title: string; detail: string; subdetail?: string; tone: "healthy" | "warning" | "error" | "neutral"; href?: string; action?: string }) {
  const markerStyle = tone === "healthy" ? "bg-emerald-100 text-emerald-700" : tone === "warning" ? "bg-amber-100 text-amber-800" : tone === "error" ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600";
  const markerLabel = tone === "healthy" ? "正常" : tone === "warning" ? "要確認" : tone === "error" ? "異常" : "未設定";
  const markerIcon = tone === "healthy" ? <Check className="size-3.5" /> : tone === "neutral" ? null : <AlertTriangle className="size-3.5" />;
  const content = <div className="grid min-h-[68px] grid-cols-[2.5rem_minmax(0,1fr)_4.5rem] items-center gap-3 px-4 py-2.5 sm:grid-cols-[2.5rem_minmax(0,1fr)_4.75rem_5.5rem] sm:px-5">
    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600 [&>svg]:size-5">{icon}</span>
    <div className="min-w-0 flex-1"><p className="text-sm font-black text-slate-900">{title}</p><p className="mt-0.5 truncate text-xs text-slate-600" title={detail}>{detail}</p>{subdetail ? <p className="mt-0.5 text-[11px] text-slate-500">{subdetail}</p> : null}</div>
    <span className={cn("inline-flex w-fit items-center gap-1 rounded-full px-2 py-1 text-[10px] font-black", markerStyle)}>{markerIcon}{markerLabel}</span>
    <span className="hidden min-w-0 items-center justify-end gap-0.5 text-xs font-bold text-slate-500 sm:flex">{action ? <>{action}<ChevronRight className="size-3.5 shrink-0" /></> : null}</span>
  </div>;
  const className = "block outline-none transition focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500";
  return href ? <Link href={href} className={cn(className, "hover:bg-slate-50")}>{content}</Link> : <div className={className}>{content}</div>;
}
