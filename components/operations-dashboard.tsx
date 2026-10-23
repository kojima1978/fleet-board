"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Database, DatabaseBackup, Download, Nfc, RefreshCw, Search, Server, UserRound, X } from "lucide-react";
import { useNfcBridgeHealth } from "@/lib/use-nfc-bridge";
import { AppHeader, HeaderSystemStatus, Navigation, type HeaderSyncState } from "./app-header";
import { Button, Card, cn } from "./ui";

type AuditLog = { id: string; actorName: string; action: string; targetType: string; description: string; createdAt: string };
type BackupStatus = { latestFile: string | null; latestAt: string | null; latestBytes: number | null; verifiedAt: string | null };
type ResponseData = { logs: AuditLog[]; backup: BackupStatus; actions: string[]; system: { appVersion: string; environment: string; deployedAt: string | null; schemaVersion: string }; pagination: { page: number; pageSize: number; total: number; pageCount: number } };
const dateTime = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function OperationsDashboard() {
  const [data, setData] = useState<ResponseData | null>(null);
  const [query, setQuery] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [lastSuccessfulSync, setLastSuccessfulSync] = useState<Date | null>(null);
  const [employeeName, setEmployeeName] = useState<string | null>(null);
  const nfcHealth = useNfcBridgeHealth(true);
  const load = useCallback(async (search = "", requestedPage = 1, actionFilter = action, fromDate = from, toDate = to) => {
    setLoading(true);
    setError("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5_000);
    try {
      const params = new URLSearchParams({ q: search, page: String(requestedPage) });
      if (actionFilter) params.set("action", actionFilter);
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      const response = await fetch(`/api/operations?${params}`, { cache: "no-store", signal: controller.signal });
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
  }, [action, from, to]);
  // 初回表示で操作履歴を読み込む。
  useEffect(() => { void load(); }, []);
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
  const downloadCsv = () => {
    const params = new URLSearchParams({ format: "csv" });
    if (query) params.set("q", query);
    if (action) params.set("action", action);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const anchor = document.createElement("a");
    anchor.href = `/api/operations?${params}`;
    anchor.click();
  };
  return <div className="min-h-screen bg-[#f4f7fb] text-slate-900">
    <AppHeader view="operations" actions={<>
      <HeaderSystemStatus syncState={syncState} lastSuccessfulSync={lastSuccessfulSync} nfcStatus={nfcHealth} refreshing={loading} onRefresh={() => void load(query, page)} onOpenNfc={openNfc} onDownloadDiagnostics={downloadDiagnostics} />
      {employeeName ? <div className="flex items-center overflow-hidden rounded-xl border border-emerald-200 bg-emerald-50"><button type="button" onClick={openNfc} title="利用者を変更" className="flex min-h-10 items-center gap-2 px-3 text-sm font-bold text-emerald-800"><UserRound className="size-4" /><span className="hidden max-w-28 truncate lg:inline">{employeeName}</span><span className="hidden text-[10px] text-emerald-600 xl:inline">変更</span></button><button type="button" onClick={clearEmployee} aria-label="利用者選択を解除" className="grid min-h-10 w-9 place-items-center border-l border-emerald-200 text-emerald-700 hover:bg-emerald-100"><X className="size-3.5" /></button></div> : <Button className="border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100" onClick={openNfc}><Nfc className="size-5" /><span className="hidden sm:inline">社員証をかざす</span></Button>}
      <button aria-label="最新情報に更新" aria-busy={loading} disabled={loading} onClick={() => void load(query, page)} className="grid size-11 place-items-center rounded-xl border border-slate-200 bg-white disabled:opacity-50"><RefreshCw className={cn("size-4", loading && "animate-spin")} /></button>
    </>} />
    <main className="mx-auto max-w-[1400px] space-y-5 p-4 pb-24 md:p-8"><div className="space-y-5"><div><p className="text-xs font-bold text-blue-600">運用管理</p><h2 className="mt-1 text-2xl font-black">操作履歴</h2><p className="mt-1 text-sm text-slate-500">誰が・いつ・何を変更したかを確認できます。</p></div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatusCard icon={<Server className="size-5" />} title="アプリ" detail={data ? `v${data.system.appVersion}・${data.system.environment === "production" ? "本番" : "開発"}` : "確認中"} healthy={Boolean(data) && !error} />
        <StatusCard icon={<Database className="size-5" />} title="データベース" detail={data ? data.system.schemaVersion : "確認中"} healthy={Boolean(data) && !error} />
        <StatusCard icon={<Nfc className="size-5" />} title="NFC" detail={nfcHealth === "ready" ? "リーダー接続済み" : nfcHealth === "no-reader" ? "Bridge起動・リーダー未接続" : nfcHealth === "connecting" ? "接続確認中" : "手動操作を利用可能"} healthy={nfcHealth === "ready"} warning={nfcHealth !== "ready"} />
        <StatusCard icon={<DatabaseBackup className="size-5" />} title="バックアップ" detail={data?.backup.latestAt ? `最終 ${dateTime.format(new Date(data.backup.latestAt))}` : "確認できません"} healthy={backupHealthy} warning={!backupHealthy} />
      </div>
      <Card className="overflow-hidden"><div className="grid gap-2 border-b border-slate-100 p-4 lg:grid-cols-[minmax(240px,1fr)_180px_150px_150px_auto]"><div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input aria-label="操作履歴を検索" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(query, 1); }} placeholder="利用者・操作・内容で検索" className="min-h-11 w-full rounded-xl border border-slate-200 pl-10 pr-3 text-sm outline-none focus:border-blue-500" /></div><select aria-label="操作種別" value={action} onChange={(event) => setAction(event.target.value)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm"><option value="">すべての操作</option>{data?.actions.map((item) => <option key={item} value={item}>{item}</option>)}</select><input aria-label="開始日" title="開始日" type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm" /><input aria-label="終了日" title="終了日" type="date" value={to} onChange={(event) => setTo(event.target.value)} className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm" /><div className="flex gap-2"><Button onClick={() => void load(query, 1)} disabled={loading}>{loading ? <RefreshCw className="size-4 animate-spin" /> : <Search className="size-4" />}{loading ? "読込中" : "検索"}</Button><Button variant="secondary" onClick={downloadCsv} disabled={!data || loading}><Download className="size-4" />CSV</Button></div><div className="lg:col-span-5"><Button variant="ghost" onClick={() => { setQuery(""); setAction(""); setFrom(""); setTo(""); void load("", 1, "", "", ""); }} disabled={loading}>条件をクリア</Button></div></div>
        {error ? <p role="alert" className="m-4 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p> : null}
        <div className="divide-y divide-slate-100">{data?.logs.map((log) => <article key={log.id} className="grid gap-2 p-4 [content-visibility:auto] sm:grid-cols-[160px_150px_1fr] sm:items-center"><time className="text-xs font-bold text-slate-500">{dateTime.format(new Date(log.createdAt))}</time><div><p className="text-sm font-black">{log.action}</p><p className="text-[11px] text-slate-400">{log.actorName}</p></div><p className="text-sm text-slate-700">{log.description}</p></article>)}</div>
        {!loading && data?.logs.length === 0 ? <p className="p-10 text-center text-sm text-slate-400">該当する操作履歴はありません</p> : null}
        {data && data.pagination.pageCount > 1 ? <div className="flex items-center justify-center gap-3 border-t border-slate-100 bg-slate-50 p-3"><Button variant="ghost" disabled={loading || page === 1} onClick={() => void load(query, page - 1)}>前へ</Button><span className="text-xs font-bold text-slate-600">{page} / {data.pagination.pageCount}ページ（全{data.pagination.total}件）</span><Button variant="ghost" disabled={loading || page === data.pagination.pageCount} onClick={() => void load(query, page + 1)}>次へ</Button></div> : null}
      </Card></div>
    </main>
    <Navigation view="operations" className="fixed inset-x-3 bottom-3 z-40 flex rounded-2xl border border-slate-200 bg-white/95 p-1.5 shadow-2xl backdrop-blur md:hidden" />
  </div>;
}

function StatusCard({ icon, title, detail, healthy, warning = false }: { icon: React.ReactNode; title: string; detail: string; healthy: boolean; warning?: boolean }) {
  const tone = healthy ? "border-emerald-200 bg-emerald-50 text-emerald-700" : warning ? "border-amber-200 bg-amber-50 text-amber-700" : "border-rose-200 bg-rose-50 text-rose-700";
  return <Card className={cn("flex items-center gap-3 p-4", tone)}><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white">{icon}</span><div className="min-w-0"><p className="text-xs font-bold opacity-75">{title}</p><p className="truncate text-sm font-black">{detail}</p></div>{healthy ? <Check className="ml-auto size-4 shrink-0" /> : <AlertTriangle className="ml-auto size-4 shrink-0" />}</Card>;
}
