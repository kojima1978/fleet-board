"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { Power } from "lucide-react";
import { NFC_BRIDGE_URL, type NfcBridgeStatus } from "@/lib/use-nfc-bridge";
import { cn } from "./ui";

// nfc-bridge/install.ps1 が登録する起動用のURL。
const NFC_BRIDGE_LAUNCH_URL = "fleetflow-nfc://start";
const SONY_NFC_DRIVER_URL = "https://www.sony.co.jp/Products/felica/consumer/support/download/nfcportsoftware.html";

// 連携ソフトやリーダーにつながらないときだけ、利用者がその場で試せる手順を出す。
// 連携ソフトが止まっているときは、最もよく使う「起動」だけを常に見せ、残りの手順は「接続方法を見る」に畳む。
export function NfcBridgeHelp({ status, className }: { status: NfcBridgeStatus; className?: string }) {
  const [launched, setLaunched] = useState(false);
  if (status !== "offline" && status !== "no-reader") return null;
  const offline = status === "offline";
  return <div className={cn("text-left text-[11px] leading-5 text-amber-900", className)}>
    {offline ? <>
      {/* 起動すれば、画面は数秒ごとの再確認で自動的に連動する。 */}
      <a href={NFC_BRIDGE_LAUNCH_URL} onClick={() => setLaunched(true)} className="inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-3 text-xs font-bold text-white hover:bg-amber-700"><Power className="size-3.5" />連携ソフトを起動</a>
      {launched ? <p className="mt-1 text-amber-800">数秒で接続します。確認が出たら「開く」を選んでください。</p> : null}
    </> : null}
    <details className={cn("rounded-xl border border-amber-200 bg-white px-3 py-2", offline && "mt-2")}>
      <summary className="cursor-pointer font-black">接続方法を見る</summary>
      {offline ? <ol className="mt-1.5 space-y-2">
        <HelpStep number="①" title="導入済みのPC">上の「連携ソフトを起動」を押します。反応がなければ②へ進みます。</HelpStep>
        <HelpStep number="②" title="初めて使うPC">
          <a href="/api/scanner/setup" className="mt-1 inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-blue-600 px-3 text-xs font-bold text-white hover:bg-blue-700">初回セットアップをダウンロード（Windows）</a>
          <p className="mt-1 text-amber-800">ダウンロードしたexeを、名前を変えずに実行します。終わったらこの画面に戻るだけです。</p>
        </HelpStep>
        <HelpStep number="③" title="うまくいかないとき"><TroubleShooting offline /></HelpStep>
      </ol> : <ol className="mt-1.5 space-y-2">
        <HelpStep number="①" title="挿し直す">NFCリーダー（RC-S300／RC-S380）またはQRスキャナ（QK30-U）をUSBに挿し直します。数秒で自動的に連動します。</HelpStep>
        <HelpStep number="②" title="うまくいかないとき"><TroubleShooting offline={false} /></HelpStep>
      </ol>}
    </details>
  </div>;
}

function HelpStep({ number, title, children }: { number: string; title: string; children: ReactNode }) {
  return <li><p className="font-bold">{number} {title}</p><div className="pl-4 text-amber-800">{children}</div></li>;
}

function TroubleShooting({ offline }: { offline: boolean }) {
  return <details className="mt-0.5">
    <summary className="cursor-pointer font-bold underline underline-offset-2">確認すること</summary>
    <ul className="mt-1 list-disc space-y-0.5 pl-4">
      {offline ? <>
        <li>ブラウザーが「このデバイス上の他のアプリやサービスへのアクセス」を求めたら「許可」を選びます。拒否した場合は、アドレスバー左のサイト設定で許可に戻します。</li>
        <li>Windowsや社内の保護機能で実行を止められた場合は、無効にせず管理者へ相談してください。</li>
      </> : <li>QRスキャナは、Active USB-COMドライバーとCOM番号の設定を確認します。</li>}
      <li>NFCリーダーは<a href={SONY_NFC_DRIVER_URL} target="_blank" rel="noopener noreferrer" className="font-bold underline underline-offset-2">Sony公式のNFCドライバー</a>が必要です。</li>
      <li><a href={`${NFC_BRIDGE_URL}/health`} target="_blank" rel="noreferrer" className="font-bold underline underline-offset-2">接続状態を開く</a>と、NFCは「readerConnected」、QRは「qrReaderConnected」がtrueなら連動済みです。</li>
      {offline ? <li>それでも連動しない場合は、管理者に連携ソフトの再インストールを依頼します。</li> : null}
    </ul>
  </details>;
}
