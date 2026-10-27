"use client";

import { useId, useState } from "react";
import { AlertTriangle, Check, DatabaseBackup, Download, FileJson, LoaderCircle, Upload } from "lucide-react";
import { Button, Card, cn } from "./ui";

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const COUNT_LABELS: Record<string, string> = {
  departments: "部署", employeeNumbers: "社員番号", employees: "社員", vehicleNumbers: "車両番号", vehicles: "車両",
  parkingSpots: "駐車区画", nfcTags: "NFCタグ", nfcAssignments: "NFC割当", trips: "利用予定・履歴", vehicleMaintenances: "整備記録", auditLogs: "操作履歴",
};

type BackupSummary = { exportedAt: string; source: { appVersion: string; schemaVersion: string }; counts: Record<string, number> };

export function DataBackupPanel() {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const [backup, setBackup] = useState<unknown>(null);
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState<"idle" | "validating" | "exporting" | "restoring" | "restored">("idle");
  const [error, setError] = useState("");

  const request = async (body: object) => {
    const response = await fetch("/api/admin/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({ message: "サーバーから正しい応答を受信できませんでした" }));
    if (!response.ok) throw new Error(result.message ?? "処理できませんでした");
    return result;
  };

  const selectFile = async (file?: File) => {
    if (!file || status === "restoring") return;
    setError(""); setSummary(null); setBackup(null); setFileName(file.name); setConfirmation("");
    if (!file.name.toLowerCase().endsWith(".json")) { setError("JSONファイルを選択してください"); return; }
    if (file.size > MAX_FILE_BYTES) { setError("JSONファイルは50MB以下にしてください"); return; }
    setStatus("validating");
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const result = await request({ mode: "validate", backup: parsed }) as BackupSummary;
      setBackup(parsed); setSummary(result); setStatus("idle");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "JSONファイルを確認できませんでした"); setStatus("idle");
    }
  };

  const exportData = async () => {
    if (status !== "idle") return;
    setError(""); setStatus("exporting");
    try {
      const response = await fetch("/api/admin/data", { cache: "no-store" });
      if (!response.ok) {
        const result = await response.json().catch(() => ({ message: "データを書き出せませんでした" }));
        throw new Error(result.message ?? "データを書き出せませんでした");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const file = disposition.match(/filename="([^"]+)"/)?.[1] ?? `fleetflow-data-${new Date().toISOString().slice(0, 10)}.json`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = file; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "データを書き出せませんでした");
    } finally { setStatus("idle"); }
  };

  const restoreData = async () => {
    if (!backup || !summary || confirmation !== "RESTORE" || status !== "idle") return;
    setError(""); setStatus("restoring");
    try {
      await request({ mode: "restore", confirmation, backup });
      setStatus("restored"); setConfirmation("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "データを復元できませんでした"); setStatus("idle");
    }
  };

  const busy = status !== "idle";
  return <div data-kiosk-auto-home-blocked={busy || summary !== null} className="grid gap-5 xl:grid-cols-2">
    <Card className="p-5">
      <span className="grid size-12 place-items-center rounded-2xl bg-blue-50 text-blue-700"><DatabaseBackup className="size-6" /></span>
      <h3 className="mt-4 text-lg font-black">JSON一括書き出し</h3>
      <p className="mt-1 text-sm leading-6 text-slate-500">社員・車両・駐車区画・NFC・利用予定・利用履歴・操作履歴を、1つのJSONファイルに保存します。</p>
      <Button className="mt-5 w-full" disabled={busy} onClick={() => void exportData()}>{status === "exporting" ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}{status === "exporting" ? "書き出し中…" : "全データをJSONで保存"}</Button>
      <p className="mt-3 text-xs leading-5 text-slate-400">NFC UIDや氏名を含むため、安全な場所で保管してください。</p>
    </Card>

    <Card className="p-5">
      <span className="grid size-12 place-items-center rounded-2xl bg-amber-50 text-amber-700"><Upload className="size-6" /></span>
      <h3 className="mt-4 text-lg font-black">JSONから一括復元</h3>
      <p className="mt-1 text-sm leading-6 text-slate-500">書き出したJSONを選択し、現在の全データを置き換えます。途中で失敗した場合は変更されません。</p>
      <label htmlFor={inputId} onDragEnter={(event) => { event.preventDefault(); if (!busy) setDragging(true); }} onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={(event) => { event.preventDefault(); if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); void selectFile(event.dataTransfer.files[0]); }} className={cn("mt-5 grid min-h-40 cursor-pointer place-items-center rounded-2xl border-2 border-dashed p-5 text-center transition", dragging ? "border-blue-500 bg-blue-50" : summary ? "border-emerald-300 bg-emerald-50/50" : "border-slate-300 bg-slate-50 hover:border-blue-400 hover:bg-blue-50/50", busy && "pointer-events-none opacity-60")}>
        <input id={inputId} type="file" accept="application/json,.json" disabled={busy} className="sr-only" onChange={(event) => { void selectFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
        <span><FileJson className={cn("mx-auto size-9", summary ? "text-emerald-600" : "text-slate-400")} />{status === "validating" ? <><span className="mt-3 block text-sm font-black text-blue-700">内容を検査中…</span><LoaderCircle className="mx-auto mt-2 size-5 animate-spin text-blue-600" /></> : <><span className="mt-3 block text-sm font-black text-slate-700">JSONをここへドラッグ＆ドロップ</span><span className="mt-1 block text-xs text-slate-500">またはクリックしてファイルを選択（最大50MB）</span></>}</span>
      </label>
      {fileName ? <p className="mt-2 truncate text-xs font-bold text-slate-600">選択中：{fileName}</p> : null}
      {summary ? <div className="mt-4 space-y-3">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><p className="flex items-center gap-2 text-sm font-black text-emerald-800"><Check className="size-4" />復元できるファイルです</p><p className="mt-1 text-xs text-emerald-700">書き出し：{new Date(summary.exportedAt).toLocaleString("ja-JP")} ・ FleetFlow {summary.source.appVersion}</p></div>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">{Object.entries(summary.counts).map(([key, count]) => <div key={key} className="rounded-lg bg-slate-50 px-3 py-2"><dt className="text-[10px] font-bold text-slate-500">{COUNT_LABELS[key] ?? key}</dt><dd className="text-sm font-black text-slate-800">{count.toLocaleString("ja-JP")}件</dd></div>)}</dl>
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3"><p className="flex items-center gap-2 text-sm font-black text-rose-800"><AlertTriangle className="size-4" />現在の全データを置き換えます</p><label className="mt-3 block text-xs font-bold text-rose-800">確認のため RESTORE と入力<input value={confirmation} disabled={busy} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" className="mt-1.5 min-h-11 w-full rounded-xl border border-rose-200 bg-white px-3 font-mono text-sm text-slate-900 outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-100" /></label></div>
        <Button variant="danger" className="w-full" disabled={confirmation !== "RESTORE" || busy} onClick={() => void restoreData()}>{status === "restoring" ? <LoaderCircle className="size-4 animate-spin" /> : <Upload className="size-4" />}{status === "restoring" ? "復元中…画面を閉じないでください" : "このJSONで全データを復元"}</Button>
      </div> : null}
      {status === "restored" ? <div role="status" className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4"><p className="font-black text-emerald-800">全データを復元しました</p><p className="mt-1 text-xs text-emerald-700">ほかの画面も復元後の内容へ更新されています。</p><Button className="mt-3" onClick={() => window.location.assign("/")}>駐車場画面で確認</Button></div> : null}
      {error ? <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p> : null}
    </Card>
  </div>;
}
