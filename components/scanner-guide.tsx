"use client";

import { useState } from "react";
import { Check, Clipboard, Download, ExternalLink, LoaderCircle, Nfc, Power, QrCode, RefreshCw, Trash2 } from "lucide-react";
import { reconnectScannerBridge, useNfcBridgeHealth, useQrBridgeHealth } from "@/lib/use-nfc-bridge";
import { Card, cn } from "./ui";

const BRIDGE_MANAGEMENT_DIRECTORY = "C:\\Users\\sashi\\Desktop\\apps\\fleet-board\\nfc-bridge";
const OPEN_BRIDGE_DIRECTORY_COMMAND = `explorer.exe "${BRIDGE_MANAGEMENT_DIRECTORY}"`;
const RESTART_COMMAND = "FleetFlow NFC-QR Restart.cmd";
const UNINSTALL_COMMAND = "FleetFlow NFC-QR Uninstall.cmd";

export function ScannerGuide() {
  const nfc = useNfcBridgeHealth();
  const qr = useQrBridgeHealth();
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectMessage, setReconnectMessage] = useState("");
  const reconnect = async () => {
    if (reconnecting) return;
    setReconnecting(true);
    setReconnectMessage("");
    const result = await reconnectScannerBridge();
    setReconnectMessage(result === "restarting" ? "再接続を開始しました。接続状態は数秒以内に更新されます。" : "Bridgeに接続できません。左側の手順で管理フォルダーを開き、再起動・再接続CMDを実行してください。");
    window.setTimeout(() => setReconnecting(false), result === "restarting" ? 7000 : 1000);
  };
  return <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
    <div className="space-y-4">
      <Card className="p-5">
        <h3 className="text-base font-black">初回セットアップ</h3>
        <p className="mt-1 text-sm leading-6 text-slate-600">NFC・QRを使用する管理者PCまたは共通端末ごとに、一度だけ実行します。一般利用者のPCには不要です。</p>
        <ol className="mt-5 space-y-5 text-sm text-slate-700">
          <GuideStep number="1" title="Sony NFCドライバーをインストール（NFC利用時のみ）">
            <p>RC-S300／RC-S380を使用する場合は、Sony公式のNFCポートソフトウェアをインストールします。QRスキャナだけを使う端末では不要です。</p>
            <a href="https://www.sony.co.jp/Products/felica/consumer/support/download/nfcportsoftware.html" target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 text-sm font-black text-blue-800 transition hover:bg-blue-100">Sony公式サイトからドライバーを入手<ExternalLink className="size-4" /></a>
            <p className="mt-2 text-xs font-bold text-amber-800">インストールにはWindowsの管理者権限が必要です。</p>
          </GuideStep>
          <GuideStep number="2" title="読取機器をUSBへ接続">
            <p>NFCリーダーまたはQRスキャナを接続します。NFCリーダーが認識されない場合はUSBハブを避け、PCへ直接接続してください。</p>
          </GuideStep>
          <GuideStep number="3" title="FleetFlow初回セットアップを実行">
            <p>セットアップをダウンロードして実行します。管理用Bridgeと自動起動、再接続用CMDがこの端末へ登録されます。</p>
            <a href="/api/scanner/setup" className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white transition hover:bg-blue-700"><Download className="size-4" />初回セットアップをダウンロード</a>
          </GuideStep>
          <GuideStep number="4" title="接続状態を確認">
            <p>セットアップ完了後、この画面の「この端末の接続状態・復旧」でNFCとQRの表示を確認します。</p>
          </GuideStep>
        </ol>
        <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-900">ドライバーとFleetFlowセットアップの順番が逆でも問題ありません。両方を導入した後にUSBを挿し直し、必要に応じて「NFC・QRを再接続」を実行してください。</p>
      </Card>

      <Card className="p-5">
        <h3 className="flex items-center gap-2 text-base font-black"><Power className="size-5 text-blue-600" />接続できない場合</h3>
        <ol className="mt-4 space-y-4 text-sm text-slate-700">
          <GuideStep number="1" title="USBを確認">NFCリーダーまたはQRスキャナを一度抜き、再度接続して数秒待ちます。</GuideStep>
          <GuideStep number="2" title="管理フォルダーを開く"><span className="block">この開発PCでは、下のコマンドでプロジェクト内の管理フォルダーを開きます。コピーして<b>Windowsキー＋R</b>へ貼り付け、Enterを押します。</span><CopyValue value={OPEN_BRIDGE_DIRECTORY_COMMAND} /><p className="mt-2 text-xs text-slate-500">ブラウザーのアドレス欄には入力しません。フォルダーが見つからない場合は、FleetFlowの保存場所を確認してください。</p></GuideStep>
          <GuideStep number="3" title="再起動・再接続を実行"><code className="rounded bg-slate-100 px-1.5 py-1 font-bold text-slate-900">{RESTART_COMMAND}</code>をダブルクリックします。Bridgeが停止・フリーズしている場合も復旧を試みます。</GuideStep>
          <GuideStep number="4" title="接続状態を確認">完了メッセージを閉じ、FleetFlowへ戻ります。接続状態は数秒以内に更新されます。</GuideStep>
        </ol>
      </Card>

    </div>

    <div className="space-y-4">
      <Card className="p-5">
        <h3 className="text-base font-black">この端末の接続状態・復旧</h3>
        <div className="mt-4 space-y-2">
          <Status icon={<Nfc className="size-4" />} label="NFCリーダー" ready={nfc === "ready"} text={nfc === "ready" ? "接続済み" : nfc === "connecting" ? "確認中" : nfc === "no-reader" ? "機器未接続" : "Bridge未接続"} />
          <Status icon={<QrCode className="size-4" />} label="QRスキャナ" ready={qr === "ready" || qr === "not-configured"} text={qr === "ready" ? "接続済み" : qr === "not-configured" ? "未設定" : "未接続"} />
        </div>
        <button type="button" onClick={() => void reconnect()} disabled={reconnecting} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-black text-white transition hover:bg-slate-800 disabled:cursor-wait disabled:bg-slate-500">{reconnecting ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}{reconnecting ? "再接続中…" : "NFC・QRを再接続"}</button>
        {reconnectMessage ? <p role="status" className={cn("mt-3 rounded-xl p-3 text-xs font-bold leading-5", reconnectMessage.startsWith("Bridge") ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800")}>{reconnectMessage}</p> : null}
      </Card>
      <Card className="p-5">
        <h3 className="flex items-center gap-2 text-base font-black"><Trash2 className="size-5 text-slate-500" />アンインストール</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">管理フォルダー内の <code className="rounded bg-slate-100 px-1.5 py-1 font-bold text-slate-900">{UNINSTALL_COMMAND}</code> をダブルクリックします。確認画面で同意した場合だけ削除されます。FleetFlow本体と業務データは削除されません。</p>
      </Card>
    </div>
  </div>;
}

function GuideStep({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3"><span className="grid size-8 place-items-center rounded-full bg-blue-600 font-black text-white">{number}</span><div><p className="font-black text-slate-950">{title}</p><div className="mt-1 leading-6">{children}</div></div></li>;
}

function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
    } else {
      const input = document.createElement("textarea");
      input.value = value;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };
  return <div className="mt-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2"><code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap px-1 font-bold text-slate-900">{value}</code><button type="button" onClick={() => void copy()} className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 text-xs font-bold text-blue-700 shadow-sm hover:bg-blue-50">{copied ? <Check className="size-4" /> : <Clipboard className="size-4" />}{copied ? "コピー済み" : "コピー"}</button></div>;
}

function Status({ icon, label, ready, text }: { icon: React.ReactNode; label: string; ready: boolean; text: string }) {
  return <div className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3"><span className={cn("grid size-8 place-items-center rounded-lg", ready ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>{icon}</span><span className="mr-auto text-sm font-bold">{label}</span><span className={cn("text-xs font-black", ready ? "text-emerald-700" : "text-amber-700")}>{text}</span></div>;
}
