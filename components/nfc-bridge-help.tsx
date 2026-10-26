"use client";

import { useState } from "react";
import { Power } from "lucide-react";
import { NFC_BRIDGE_URL, type NfcBridgeStatus } from "@/lib/use-nfc-bridge";
import { cn } from "./ui";

// nfc-bridge/install.ps1 が登録する起動用のURL。
const NFC_BRIDGE_LAUNCH_URL = "fleetflow-nfc://start";
const SONY_NFC_DRIVER_URL = "https://www.sony.co.jp/Products/felica/consumer/support/download/nfcportsoftware.html";

const OFFLINE_STEPS = [
  "初回は下の「初回セットアップ」をダウンロードし、実行するだけで導入できます。DockerやURL入力は不要です。",
  "ブラウザーが「このデバイス上の他のアプリやサービスへのアクセス」を求めたら「許可」を選びます。拒否した場合は、アドレスバー左のサイト設定で許可に戻します。",
  "それでも連動しない場合は、管理者にFleetFlow連携ソフトの再インストールを依頼します。",
];
const NO_READER_STEPS = [
  "使用するNFCリーダー（RC-S300／RC-S380）またはQRスキャナ（QK30-U）をUSBに挿し直します。",
  "NFCはSony NFCポートソフトウェア、QRはActive USB-COMドライバーとCOM番号の設定を確認します。",
  "挿し直すと数秒で自動的に連動します。",
];

// 連携ソフトやリーダーにつながらないときだけ、利用者がその場で試せる手順を出す。
export function NfcBridgeHelp({ status, defaultOpen = false, className }: { status: NfcBridgeStatus; defaultOpen?: boolean; className?: string }) {
  const [launched, setLaunched] = useState(false);
  if (status !== "offline" && status !== "no-reader") return null;
  const steps = status === "offline" ? OFFLINE_STEPS : NO_READER_STEPS;
  return <details open={defaultOpen} className={cn("rounded-xl border border-amber-200 bg-white px-3 py-2 text-left text-[11px] leading-5 text-amber-900", className)}>
    <summary className="cursor-pointer font-black">NFC・QRを連動する方法</summary>
    {status === "offline" ? <div className="mt-1.5">
      {/* 起動すれば、画面は数秒ごとの再確認で自動的に連動する。 */}
      <a href={NFC_BRIDGE_LAUNCH_URL} onClick={() => setLaunched(true)} className="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-3 text-xs font-bold text-white hover:bg-amber-700"><Power className="size-3.5" />連携ソフトを起動</a>
      <p className="mt-1 text-amber-800">{launched ? "導入済みの場合は数秒で接続します。確認が出たら「開く」を選んでください。反応がなければ下の初回セットアップを実行してください。" : "導入済みのPCはこちら。初めて使うPCは下のセットアップを実行してください。"}</p>
      <a href="/api/scanner/setup" className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-blue-600 px-3 text-xs font-bold text-white hover:bg-blue-700">初回セットアップをダウンロード（Windows）</a>
      <p className="mt-1 text-amber-800">ダウンロードしたexeを名前を変えずに実行してください。接続先は自動設定され、完了後はこの画面に戻るだけです。Windowsや社内の保護機能で実行を制限された場合は、無効化せず管理者へ相談してください。</p>
    </div> : null}
    <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">{steps.map((step) => <li key={step}>{step}</li>)}</ol>
    <a href={SONY_NFC_DRIVER_URL} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-9 w-full items-center justify-center rounded-lg border border-amber-300 px-3 font-bold underline underline-offset-2 hover:bg-amber-50">Sony公式：NFCドライバーのダウンロード</a>
    <p className="mt-1 text-amber-800">RC-S300／RC-S380用です。公式ページからダウンロードし、案内に従ってインストールしてください。</p>
    <p className="mt-1.5 text-amber-800"><a href={`${NFC_BRIDGE_URL}/health`} target="_blank" rel="noreferrer" className="font-bold underline underline-offset-2">接続状態を開く</a>と、NFCは「readerConnected」、QRは「qrReaderConnected」がtrueなら連動済みです。連動するまでは手動選択で使えます。</p>
  </details>;
}
