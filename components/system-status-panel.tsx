"use client";

import Link from "next/link";
import { AlertTriangle, Check, ChevronRight, Database, DatabaseBackup, Nfc, QrCode, Server } from "lucide-react";
import type { HeaderSyncState } from "./app-header";
import type { NfcBridgeStatus, QrBridgeStatus } from "@/lib/use-nfc-bridge";
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
  const now = Date.now();
  const appHealthy = syncState === "healthy";
  const backupHealthy = Boolean(system.backupLatestAt) && now - new Date(system.backupLatestAt!).getTime() < DAY_MS;
  const verificationHealthy = Boolean(system.backupVerifiedAt) && now - new Date(system.backupVerifiedAt!).getTime() < DAY_MS;
  const backupDetail = system.backupLatestAt ? `最終 ${dateTime.format(new Date(system.backupLatestAt))}` : "バックアップを確認できません";
  const appDetail = system.environment === "production" ? `v${system.appVersion}・本番` : system.appVersion === "development" ? "開発環境" : `v${system.appVersion}・開発`;
  const nfcDetail = nfcStatus === "ready" ? "接続済み" : nfcStatus === "connecting" ? "確認中" : nfcStatus === "no-reader" ? "Bridge起動・機器未接続" : nfcStatus === "idle" ? "この端末では未使用" : "Bridge未接続";
  const qrDetail = qrStatus === "ready" ? "接続済み" : qrStatus === "not-configured" ? "未設定" : "未接続";

  return <section aria-label="システム状態一覧" className="flex flex-wrap overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 shadow-sm">
      <StatusCard icon={<Server className="size-5" />} title="アプリ" detail={appDetail} tone={appHealthy ? "healthy" : "error"} />
      <StatusCard icon={<Database className="size-5" />} title="データベース" detail={appHealthy ? system.schemaVersion : "接続を確認してください"} tone={appHealthy ? "healthy" : "error"} />
      <StatusCard icon={<DatabaseBackup className="size-5" />} title="バックアップ" detail={backupDetail} subdetail={verificationHealthy ? "復元確認済み" : "復元確認が必要"} tone={backupHealthy && verificationHealthy ? "healthy" : "warning"} href="/settings/data" action="保存・復元" />
      <StatusCard icon={<Nfc className="size-5" />} title="NFCリーダー" detail={nfcDetail} tone={nfcStatus === "ready" || nfcStatus === "idle" ? "healthy" : "warning"} href="/settings/scanner" action="接続管理" />
      <StatusCard icon={<QrCode className="size-5" />} title="QRスキャナ" detail={qrDetail} tone={qrStatus === "ready" ? "healthy" : qrStatus === "not-configured" ? "neutral" : "warning"} href="/settings/scanner" action="接続管理" />
  </section>;
}

function StatusCard({ icon, title, detail, subdetail, tone, href, action }: { icon: React.ReactNode; title: string; detail: string; subdetail?: string; tone: "healthy" | "warning" | "error" | "neutral"; href?: string; action?: string }) {
  const style = tone === "healthy" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : tone === "warning" ? "border-amber-200 bg-amber-50 text-amber-800" : tone === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-slate-200 bg-slate-50 text-slate-700";
  const marker = tone === "healthy" ? <Check className="size-4" /> : tone === "neutral" ? null : <AlertTriangle className="size-4" />;
  const content = <><div className="flex items-start gap-2"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/80 [&>svg]:size-4">{icon}</span><div className="min-w-0 flex-1"><p className="text-[11px] font-bold opacity-75">{title}</p><p className="truncate text-xs font-black" title={detail}>{detail}</p>{subdetail ? <p className="mt-0.5 text-[10px] font-bold opacity-75">{subdetail}</p> : null}</div>{marker}</div>{action ? <span className="mt-2 flex items-center justify-end gap-0.5 text-[11px] font-black">{action}<ChevronRight className="size-3.5" /></span> : null}</>;
  const className = cn("min-h-20 min-w-44 flex-1 p-3 outline-none transition focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-blue-500", style);
  return href ? <Link href={href} className={cn(className, "hover:brightness-[0.98]")}>{content}</Link> : <div className={className}>{content}</div>;
}
