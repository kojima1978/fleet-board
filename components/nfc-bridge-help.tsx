"use client";

import Link from "next/link";
import { FolderOpen } from "lucide-react";
import type { NfcBridgeStatus } from "@/lib/use-nfc-bridge";
import { cn } from "./ui";

// 未接続時は、廃止したショートカットやカスタムURLの操作を案内せず、
// FleetFlow内の最新ガイドへ一本化する。
export function NfcBridgeHelp({ status, className }: { status: NfcBridgeStatus; className?: string }) {
  if (status !== "offline" && status !== "no-reader") return null;
  return <div className={cn("text-left text-[11px] leading-5 text-amber-900", className)}>
    <p>{status === "offline" ? "Bridgeを確認できません。管理フォルダーから再起動できます。" : "USBを挿し直しても戻らない場合は、管理フォルダーから再接続できます。"}</p>
    <Link href="/settings/scanner" className="mt-2 inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 text-xs font-black text-amber-900 hover:bg-amber-50"><FolderOpen className="size-4" />NFC・QR 接続ガイドを開く</Link>
  </div>;
}
