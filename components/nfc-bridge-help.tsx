"use client";

import { useState } from "react";
import { Power } from "lucide-react";
import { NFC_BRIDGE_URL, type NfcBridgeStatus } from "@/lib/use-nfc-bridge";
import { cn } from "./ui";

// nfc-bridge/install.ps1 が登録する起動用のURL。
const NFC_BRIDGE_LAUNCH_URL = "fleetflow-nfc://start";

const OFFLINE_STEPS = [
  "ボタンで起動しない場合は、Windowsへサインインし直します（連携ソフトはサインイン時に自動で起動します）。",
  "ブラウザーが「このデバイス上の他のアプリやサービスへのアクセス」を求めたら「許可」を選びます。拒否した場合は、アドレスバー左のサイト設定で許可に戻します。",
  "それでも連動しない場合は、管理者に連携ソフト（NFC Bridge）の再インストールを依頼します。",
];
const NO_READER_STEPS = [
  "NFCリーダー（RC-S300／RC-S380）をUSBに挿し直します。",
  "Sony NFCポートソフトウェアが入っているか確認します。",
  "挿し直すと数秒で自動的に連動します。",
];

// 連携ソフトやリーダーにつながらないときだけ、利用者がその場で試せる手順を出す。
export function NfcBridgeHelp({ status, defaultOpen = false, className }: { status: NfcBridgeStatus; defaultOpen?: boolean; className?: string }) {
  const [launched, setLaunched] = useState(false);
  if (status !== "offline" && status !== "no-reader") return null;
  const steps = status === "offline" ? OFFLINE_STEPS : NO_READER_STEPS;
  return <details open={defaultOpen} className={cn("rounded-xl border border-amber-200 bg-white px-3 py-2 text-left text-[11px] leading-5 text-amber-900", className)}>
    <summary className="cursor-pointer font-black">NFCを連動する方法</summary>
    {status === "offline" ? <div className="mt-1.5">
      {/* 起動すれば、画面は数秒ごとの再確認で自動的に連動する。 */}
      <a href={NFC_BRIDGE_LAUNCH_URL} onClick={() => setLaunched(true)} className="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-3 text-xs font-bold text-white hover:bg-amber-700"><Power className="size-3.5" />連携ソフトを起動</a>
      <p className="mt-1 text-amber-800">{launched ? "起動しています。数秒で自動的に連動します。ブラウザーが開いてよいか尋ねたら「開く」を選んでください。" : "押すと連携ソフトを起動し、自動で連動します。"}</p>
    </div> : null}
    <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">{steps.map((step) => <li key={step}>{step}</li>)}</ol>
    <p className="mt-1.5 text-amber-800"><a href={`${NFC_BRIDGE_URL}/health`} target="_blank" rel="noreferrer" className="font-bold underline underline-offset-2">接続状態を開く</a>と、「readerConnected」がtrueなら連動済みです。連動するまでは手動選択で使えます。</p>
  </details>;
}
