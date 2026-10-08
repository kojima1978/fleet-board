"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, DatabaseBackup, Nfc, RefreshCw, Search, UserRound, X } from "lucide-react";
import { useNfcBridgeHealth } from "@/lib/use-nfc-bridge";
import { AppHeader, HeaderSystemStatus, Navigation, type HeaderSyncState } from "./app-header";
import { Button, Card, cn } from "./ui";

type AuditLog = { id: string; actorName: string; action: string; targetType: string; description: string; createdAt: string };
type BackupStatus = { latestFile: string | null; latestAt: string | null; latestBytes: number | null; verifiedAt: string | null };
type ResponseData = { logs: AuditLog[]; backup: BackupStatus; pagination: { page: number; pageSize: number; total: number; pageCount: number } };
const dateTime = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function OperationsDashboard() {
  const [data, setData] = useState<ResponseData | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [lastSuccessfulSync, setLastSuccessfulSync] = useState<Date | null>(null);
  const [employeeName, setEmployeeName] = useState<string | null>(null);
  const nfcHealth = useNfcBridgeHealth(true);
  const load = useCallback(async (search = "", requestedPage = 1) => {
    setLoading(true);
    setError("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(`/api/operations?q=${encodeURIComponent(search)}&page=${requestedPage}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error();
      setData(await response.json());
      setPage(requestedPage);
      setLastSuccessfulSync(new Date());
    } catch {
      setError("操作履歴を取得できませんでした。接続状態を確認してください。");
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const employeeId = window.sessionStorage.getItem("fleetflow.employeeId");
    setEmployeeName(employeeId ? window.sessionStorage.getItem("fleetflow.employeeName") ?? "利用者選択済み" : null);
  }, []);
  const backupHealthy = data?.backup.latestAt ? Date.now() - new Date(data.backup.latestAt).getTime() < 26 * 60 * 60_000 : false;
  const syncState: HeaderSyncState = error ? "stale" : data ? "healthy" : "loading";
  const openNfc = () => window.location.assign("/?nfc=1");
  const clearEmployee = () => {
    window.sessionStorage.removeItem("fleetflow.employeeId");
    window.sessionStorage.removeItem("fleetflow.employeeName");
    setEmployeeName(null);
  };
  const downloadDiagnostics = () => {
    const diagnostics = {
      checkedAt: new Date().toISOString(),
      page: "operations",
      application: syncState,
      lastSuccessfulSync: lastSuccessfulSync?.toISOString() ?? null,
      nfcBridge: nfcHealth,
      backupLatestAt: data?.backup.latestAt ?? null,
      backupVerifiedAt: data?.backup.verifiedAt ?? null,
      userAgent: navigator.userAgent,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(diagnostics, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `fleetflow-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return <div className="min-h-screen bg-[#f4f7fb] text-slate-900">
    <AppHeader view="operations" actions={<>
      <HeaderSystemStatus syncState={syncState} lastSuccessfulSync={lastSuccessfulSync} nfcStatus={nfcHealth} refreshing={loading} onRefresh={() => void load(query, page)} onOpenNfc={openNfc} onDownloadDiagnostics={downloadDiagnostics} />
      {employeeName ? <div className="flex items-center overflow-hidden rounded-xl border border-emerald-200 bg-emerald-50"><button type="button" onClick={openNfc} title="利用者を変更" className="flex min-h-10 items-center gap-2 px-3 text-sm font-bold text-emerald-800"><UserRound className="size-4" /><span className="hidden max-w-28 truncate lg:inline">{employeeName}</span><span className="hidden text-[10px] text-emerald-600 xl:inline">変更</span></button><button type="button" onClick={clearEmployee} aria-label="利用者選択を解除" className="grid min-h-10 w-9 place-items-center border-l border-emerald-200 text-emerald-700 hover:bg-emerald-100"><X className="size-3.5" /></button></div> : <Button className="border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100" onClick={openNfc}><Nfc className="size-5" /><span className="hidden sm:inline">社員証をかざす</span></Button>}
      <button aria-label="最新情報に更新" aria-busy={loading} disabled={loading} onClick={() => void load(query, page)} className="grid size-11 place-items-center rounded-xl border border-slate-200 bg-white disabled:opacity-50"><RefreshCw className={cn("size-4", loading && "animate-spin")} /></button>
    </>} />
    <main className="mx-auto max-w-[1400px] space-y-5 p-4 pb-24 md:p-8"><div><p className="text-xs font-bold text-blue-600">運用管理</p><h2 className="mt-1 text-2xl font-black">操作履歴</h2><p className="mt-1 text-sm text-slate-500">誰が・いつ・何を変更したかを確認できます。</p></div>
      <Card className={cn("flex flex-wrap items-center gap-3 p-4", backupHealthy ? "border-emerald-200 bg-emerald-50" : "border-amber-300 bg-amber-50")}><span className={cn("grid size-11 place-items-center rounded-xl text-white", backupHealthy ? "bg-emerald-600" : "bg-amber-500")}><DatabaseBackup className="size-5" /></span><div className="mr-auto"><p className="font-black">DBバックアップ</p><p className="text-xs text-slate-600">{data?.backup.latestAt ? `最終成功 ${dateTime.format(new Date(data.backup.latestAt))} ・ ${Math.max(1, Math.round((data.backup.latestBytes ?? 0) / 1024))} KB` : "バックアップを確認できません"}</p><p className="mt-0.5 text-[11px] text-slate-500">復元確認：{data?.backup.verifiedAt ? dateTime.format(new Date(data.backup.verifiedAt)) : "未実施"}</p></div><span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold", backupHealthy ? "bg-white text-emerald-700" : "bg-white text-amber-800")}>{backupHealthy ? <Check className="size-4" /> : <AlertTriangle className="size-4" />}{backupHealthy ? "正常" : "確認が必要"}</span></Card>
      <Card className="overflow-hidden"><div className="flex flex-wrap gap-2 border-b border-slate-100 p-4"><div className="relative min-w-64 flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input aria-label="操作履歴を検索" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(query, 1); }} placeholder="利用者・操作・内容で検索" className="min-h-11 w-full rounded-xl border border-slate-200 pl-10 pr-3 text-sm outline-none focus:border-blue-500" /></div><Button onClick={() => void load(query, 1)} disabled={loading}>{loading ? <RefreshCw className="size-4 animate-spin" /> : <Search className="size-4" />}{loading ? "読込中" : "検索"}</Button><Button variant="ghost" onClick={() => { setQuery(""); void load("", 1); }} disabled={loading}>クリア</Button></div>
        {error ? <p role="alert" className="m-4 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p> : null}
        <div className="divide-y divide-slate-100">{data?.logs.map((log) => <article key={log.id} className="grid gap-2 p-4 [content-visibility:auto] sm:grid-cols-[160px_150px_1fr] sm:items-center"><time className="text-xs font-bold text-slate-500">{dateTime.format(new Date(log.createdAt))}</time><div><p className="text-sm font-black">{log.action}</p><p className="text-[11px] text-slate-400">{log.actorName}</p></div><p className="text-sm text-slate-700">{log.description}</p></article>)}</div>
        {!loading && data?.logs.length === 0 ? <p className="p-10 text-center text-sm text-slate-400">該当する操作履歴はありません</p> : null}
        {data && data.pagination.pageCount > 1 ? <div className="flex items-center justify-center gap-3 border-t border-slate-100 bg-slate-50 p-3"><Button variant="ghost" disabled={loading || page === 1} onClick={() => void load(query, page - 1)}>前へ</Button><span className="text-xs font-bold text-slate-600">{page} / {data.pagination.pageCount}ページ（全{data.pagination.total}件）</span><Button variant="ghost" disabled={loading || page === data.pagination.pageCount} onClick={() => void load(query, page + 1)}>次へ</Button></div> : null}
      </Card>
    </main>
    <Navigation view="operations" className="fixed inset-x-3 bottom-3 z-40 flex rounded-2xl border border-slate-200 bg-white/95 p-1.5 shadow-2xl backdrop-blur md:hidden" />
  </div>;
}
