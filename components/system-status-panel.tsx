"use client";

import Link from "next/link";
import { AlertTriangle, Check, ChevronRight, Database, DatabaseBackup, Nfc, QrCode, Server } from "lucide-react";
import type { HeaderSyncState } from "./app-header";
import type { NfcBridgeStatus, QrBridgeStatus } from "@/lib/use-nfc-bridge";
import { Card, cn } from "./ui";

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
  const nfcDetail = nfcStatus === "ready" ? "接続済み" : nfcStatus === "connecting" ? "確認中" : nfcStatus === "no-reader" ? "Bridge起動・機器未接続" : nfcStatus === "idle" ? "この端末では未使用" : "Bridge未接続";
  const qrDetail = qrStatus === "ready" ? "接続済み" : qrStatus === "not-configured" ? "未設定" : "未接続";

  return <div className="space-y-4">
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      <StatusCard icon={<Server className="size-5" />} title="アプリ" detail={`v${system.appVersion}・${system.environment === "production" ? "本番" : "開発"}`} tone={appHealthy ? "healthy" : "error"} />
      <StatusCard icon={<Database className="size-5" />} title="データベース" detail={appHealthy ? system.schemaVersion : "接続を確認してください"} tone={appHealthy ? "healthy" : "error"} />
      <StatusCard icon={<DatabaseBackup className="size-5" />} title="バックアップ" detail={backupDetail} subdetail={verificationHealthy ? "復元確認済み" : "復元確認が必要"} tone={backupHealthy && verificationHealthy ? "healthy" : "warning"} href="/settings/data" action="保存・復元を開く" />
      <StatusCard icon={<Nfc className="size-5" />} title="NFCリーダー" detail={nfcDetail} tone={nfcStatus === "ready" || nfcStatus === "idle" ? "healthy" : "warning"} href="/settings/scanner" action="接続管理を開く" />
      <StatusCard icon={<QrCode className="size-5" />} title="QRスキャナ" detail={qrDetail} tone={qrStatus === "ready" ? "healthy" : qrStatus === "not-configured" ? "neutral" : "warning"} href="/settings/scanner" action="接続管理を開く" />
    </div>
    <Card className="p-4 text-sm text-slate-600"><p className="font-black text-slate-900">この画面の役割</p><p className="mt-1 leading-6">システム全体の状態を確認する画面です。利用・返却などの操作記録は「履歴」、機器の再接続は「NFC・QR」、バックアップの書き出し・復元は「データ保存・復元」で行います。</p></Card>
  </div>;
}

function StatusCard({ icon, title, detail, subdetail, tone, href, action }: { icon: React.ReactNode; title: string; detail: string; subdetail?: string; tone: "healthy" | "warning" | "error" | "neutral"; href?: string; action?: string }) {
  const style = tone === "healthy" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : tone === "warning" ? "border-amber-200 bg-amber-50 text-amber-800" : tone === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-slate-200 bg-slate-50 text-slate-700";
  const marker = tone === "healthy" ? <Check className="size-4" /> : tone === "neutral" ? null : <AlertTriangle className="size-4" />;
  const content = <><div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white">{icon}</span><div className="min-w-0 flex-1"><p className="text-xs font-bold opacity-75">{title}</p><p className="mt-0.5 break-words text-sm font-black">{detail}</p>{subdetail ? <p className="mt-1 text-[11px] font-bold opacity-75">{subdetail}</p> : null}</div>{marker}</div>{action ? <span className="mt-3 flex items-center justify-end gap-1 border-t border-current/10 pt-2 text-xs font-black">{action}<ChevronRight className="size-4" /></span> : null}</>;
  return href ? <Link href={href} className={cn("rounded-2xl border p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md", style)}>{content}</Link> : <Card className={cn("p-4", style)}>{content}</Card>;
}
