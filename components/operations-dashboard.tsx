"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Download, RefreshCw, Search } from "lucide-react";
import { clearSavedEmployee, forgetPersistentEmployee, readSavedEmployee } from "@/lib/employee-session";
import { isKioskDevice, useDeviceMode } from "@/lib/device-mode";
import { useNfcBridgeHealth, useQrBridgeHealth } from "@/lib/use-nfc-bridge";
import { AppHeader, HeaderDeviceMode, HeaderSystemStatus, HeaderUserControl, Navigation, type HeaderSyncState } from "./app-header";
import { Button, Card, cn } from "./ui";

type AuditLog = { id: string; actorName: string; action: string; targetType: string; description: string; createdAt: string };
type ResponseData = { logs: AuditLog[]; actions: string[]; pagination: { page: number; pageSize: number; total: number; pageCount: number } };
const dateTime = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const StartTimeHistory = dynamic(() => import("./start-time-history").then((module) => module.StartTimeHistory));
const VehicleUseHistory = dynamic(() => import("./vehicle-use-history").then((module) => module.VehicleUseHistory));

export function OperationsDashboard() {
  const [historyTab, setHistoryTab] = useState<"vehicles" | "operations">("vehicles");
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [otherOpen, setOtherOpen] = useState(false);
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
  const qrHealth = useQrBridgeHealth(true);
  const scannerHealth = nfcHealth === "ready" || qrHealth === "ready" ? "ready" : nfcHealth;
  const kiosk = isKioskDevice(useDeviceMode(), scannerHealth);
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
    // 共用端末では「この端末の利用者」を残さない。
    if (kiosk) forgetPersistentEmployee();
    const saved = readSavedEmployee();
    setEmployeeName(saved ? saved.name ?? "利用者選択済み" : null);
  }, [kiosk]);
  const syncState: HeaderSyncState = error ? "stale" : data ? "healthy" : "loading";
  const clearEmployee = () => {
    clearSavedEmployee();
    setEmployeeName(null);
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
    <AppHeader view="operations" kiosk={kiosk} actions={<>
      <HeaderSystemStatus syncState={syncState} lastSuccessfulSync={lastSuccessfulSync} nfcStatus={nfcHealth} qrStatus={qrHealth} />
      <HeaderDeviceMode nfcStatus={scannerHealth} />
      <HeaderUserControl nfcStatus={scannerHealth} nfcListening={false} employeeName={employeeName} onPick={() => window.location.assign("/?user=1")} onClear={clearEmployee} />
      <button aria-label="最新情報に更新" aria-busy={loading} disabled={loading} onClick={() => { setHistoryRefresh((value) => value + 1); void load(query, page); }} className="grid size-11 place-items-center rounded-xl border border-slate-200 bg-white disabled:opacity-50"><RefreshCw className={cn("size-4", loading && "animate-spin")} /></button>
    </>} />
    <main className="mx-auto max-w-[1400px] space-y-5 p-4 pb-24 md:p-8"><div className="space-y-5"><div><p className="text-xs font-bold text-blue-600">運用管理</p><h2 className="mt-1 text-2xl font-black">履歴</h2><p className="mt-1 text-sm text-slate-500">{historyTab === "vehicles" ? "車両ごとに、誰が・いつ利用したかを確認できます。予約・取消は含みません。" : "誰が・いつ・何を変更したかを確認できます。"}</p></div>
      <div role="tablist" aria-label="履歴の種類" className="flex w-fit gap-1 rounded-xl border border-slate-200 bg-white p-1">{([{ id: "vehicles", label: "車両利用履歴" }, { id: "operations", label: "操作履歴" }] as const).map((tab) => <button key={tab.id} id={`history-tab-${tab.id}`} role="tab" aria-selected={historyTab === tab.id} aria-controls={`history-panel-${tab.id}`} onClick={() => setHistoryTab(tab.id)} className={cn("min-h-11 rounded-lg px-4 text-sm font-bold", historyTab === tab.id ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50")}>{tab.label}</button>)}</div>
      <section id="history-panel-vehicles" role="tabpanel" aria-labelledby="history-tab-vehicles" hidden={historyTab !== "vehicles"} className="space-y-5">
      <div><Button variant="ghost" aria-expanded={otherOpen} onClick={() => setOtherOpen((value) => !value)}>その他：利用開始時刻を訂正</Button>{otherOpen ? <StartTimeHistory onSaved={() => { setHistoryRefresh((value) => value + 1); void load(query, page); }} /> : null}</div>
      <VehicleUseHistory refreshKey={historyRefresh} /></section>
      <section id="history-panel-operations" role="tabpanel" aria-labelledby="history-tab-operations" hidden={historyTab !== "operations"} className="space-y-5">
      <Card className="overflow-hidden"><div className="space-y-3 border-b border-slate-100 p-4"><div className="flex flex-wrap items-end gap-2"><div className="w-full sm:w-80"><span className="text-xs font-bold text-slate-600">キーワード</span><div className="relative mt-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input aria-label="操作履歴を検索" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(query, 1); }} placeholder="利用者・操作・内容で検索" className="min-h-11 w-full rounded-xl border border-slate-200 pl-10 pr-3 text-sm outline-none focus:border-blue-500" /></div></div><div><span className="text-xs font-bold text-slate-600">操作の種類</span><select aria-label="操作種別" value={action} onChange={(event) => setAction(event.target.value)} className="mt-1 block min-h-11 w-48 rounded-xl border border-slate-200 bg-white px-3 text-sm"><option value="">すべての操作</option>{data?.actions.map((item) => <option key={item} value={item}>{item}</option>)}</select></div><div><span className="text-xs font-bold text-slate-600">期間</span><div className="mt-1 flex items-center gap-2"><input aria-label="開始日" title="開始日" type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="min-h-11 w-40 rounded-xl border border-slate-200 px-3 text-sm" /><span className="text-sm text-slate-400">〜</span><input aria-label="終了日" title="終了日" type="date" value={to} onChange={(event) => setTo(event.target.value)} className="min-h-11 w-40 rounded-xl border border-slate-200 px-3 text-sm" /></div></div></div><div className="flex flex-wrap gap-2"><Button onClick={() => void load(query, 1)} disabled={loading}>{loading ? <RefreshCw className="size-4 animate-spin" /> : <Search className="size-4" />}{loading ? "読込中" : "検索"}</Button><Button variant="secondary" onClick={downloadCsv} disabled={!data || loading}><Download className="size-4" />CSV</Button><Button variant="ghost" onClick={() => { setQuery(""); setAction(""); setFrom(""); setTo(""); void load("", 1, "", "", ""); }} disabled={loading}>条件をクリア</Button></div></div>
        {error ? <p role="alert" className="m-4 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p> : null}
        <div className="divide-y divide-slate-100">{data?.logs.map((log) => <article key={log.id} className="grid gap-2 p-4 [content-visibility:auto] sm:grid-cols-[160px_150px_1fr] sm:items-center"><time className="text-xs font-bold text-slate-500">{dateTime.format(new Date(log.createdAt))}</time><div><p className="text-sm font-black">{log.action}</p><p className="text-[11px] text-slate-400">{log.actorName}</p></div><p className="text-sm text-slate-700">{log.description}</p></article>)}</div>
        {!loading && data?.logs.length === 0 ? <p className="p-10 text-center text-sm text-slate-400">該当する操作履歴はありません</p> : null}
        {data && data.pagination.pageCount > 1 ? <div className="flex items-center justify-center gap-3 border-t border-slate-100 bg-slate-50 p-3"><Button variant="ghost" disabled={loading || page === 1} onClick={() => void load(query, page - 1)}>前へ</Button><span className="text-xs font-bold text-slate-600">{page} / {data.pagination.pageCount}ページ（全{data.pagination.total}件）</span><Button variant="ghost" disabled={loading || page === data.pagination.pageCount} onClick={() => void load(query, page + 1)}>次へ</Button></div> : null}
      </Card></section></div>
    </main>
    <Navigation view="operations" className="fixed inset-x-3 bottom-3 z-40 flex rounded-2xl border border-slate-200 bg-white/95 p-1.5 shadow-2xl backdrop-blur lg:hidden" />
  </div>;
}
