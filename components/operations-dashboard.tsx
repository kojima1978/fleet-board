"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Archive, CarFront, Check, Clock3, DatabaseBackup, LayoutGrid, RefreshCw, Search, Settings } from "lucide-react";
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
    } catch {
      setError("操作履歴を取得できませんでした。接続状態を確認してください。");
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const backupHealthy = data?.backup.latestAt ? Date.now() - new Date(data.backup.latestAt).getTime() < 26 * 60 * 60_000 : false;
  return <div className="min-h-screen bg-[#f4f7fb] text-slate-900">
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur"><div className="mx-auto flex max-w-[1600px] items-center gap-4 px-4 py-3 md:px-8"><div className="grid size-11 place-items-center rounded-2xl bg-blue-600 text-white"><CarFront /></div><div className="mr-auto"><h1 className="text-lg font-black">FleetFlow</h1><p className="text-xs text-slate-500">操作履歴・保守</p></div><nav aria-label="メインメニュー" className="hidden items-center gap-1 md:flex"><Link href="/" className="flex min-h-10 items-center gap-2 rounded-xl px-4 text-xs font-bold text-slate-500 hover:bg-slate-100"><LayoutGrid className="size-4" />駐車場</Link><Link href="/timeline" className="flex min-h-10 items-center gap-2 rounded-xl px-4 text-xs font-bold text-slate-500 hover:bg-slate-100"><Clock3 className="size-4" />タイムライン</Link><Link href="/settings/employees" className="flex min-h-10 items-center gap-2 rounded-xl px-4 text-xs font-bold text-slate-500 hover:bg-slate-100"><Settings className="size-4" />設定</Link><span className="flex min-h-10 items-center gap-2 rounded-xl bg-slate-900 px-4 text-xs font-bold text-white"><Archive className="size-4" />履歴</span></nav></div></header>
    <main className="mx-auto max-w-[1400px] space-y-5 p-4 pb-24 md:p-8"><div><p className="text-xs font-bold text-blue-600">運用管理</p><h2 className="mt-1 text-2xl font-black">操作履歴</h2><p className="mt-1 text-sm text-slate-500">誰が・いつ・何を変更したかを確認できます。</p></div>
      <Card className={cn("flex flex-wrap items-center gap-3 p-4", backupHealthy ? "border-emerald-200 bg-emerald-50" : "border-amber-300 bg-amber-50")}><span className={cn("grid size-11 place-items-center rounded-xl text-white", backupHealthy ? "bg-emerald-600" : "bg-amber-500")}><DatabaseBackup className="size-5" /></span><div className="mr-auto"><p className="font-black">DBバックアップ</p><p className="text-xs text-slate-600">{data?.backup.latestAt ? `最終成功 ${dateTime.format(new Date(data.backup.latestAt))} ・ ${Math.max(1, Math.round((data.backup.latestBytes ?? 0) / 1024))} KB` : "バックアップを確認できません"}</p><p className="mt-0.5 text-[11px] text-slate-500">復元確認：{data?.backup.verifiedAt ? dateTime.format(new Date(data.backup.verifiedAt)) : "未実施"}</p></div><span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold", backupHealthy ? "bg-white text-emerald-700" : "bg-white text-amber-800")}>{backupHealthy ? <Check className="size-4" /> : <AlertTriangle className="size-4" />}{backupHealthy ? "正常" : "確認が必要"}</span></Card>
      <Card className="overflow-hidden"><div className="flex flex-wrap gap-2 border-b border-slate-100 p-4"><div className="relative min-w-64 flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input aria-label="操作履歴を検索" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(query, 1); }} placeholder="利用者・操作・内容で検索" className="min-h-11 w-full rounded-xl border border-slate-200 pl-10 pr-3 text-sm outline-none focus:border-blue-500" /></div><Button onClick={() => void load(query, 1)} disabled={loading}>{loading ? <RefreshCw className="size-4 animate-spin" /> : <Search className="size-4" />}{loading ? "読込中" : "検索"}</Button><Button variant="ghost" onClick={() => { setQuery(""); void load("", 1); }} disabled={loading}>クリア</Button></div>
        {error ? <p role="alert" className="m-4 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p> : null}
        <div className="divide-y divide-slate-100">{data?.logs.map((log) => <article key={log.id} className="grid gap-2 p-4 [content-visibility:auto] sm:grid-cols-[160px_150px_1fr] sm:items-center"><time className="text-xs font-bold text-slate-500">{dateTime.format(new Date(log.createdAt))}</time><div><p className="text-sm font-black">{log.action}</p><p className="text-[11px] text-slate-400">{log.actorName}</p></div><p className="text-sm text-slate-700">{log.description}</p></article>)}</div>
        {!loading && data?.logs.length === 0 ? <p className="p-10 text-center text-sm text-slate-400">該当する操作履歴はありません</p> : null}
        {data && data.pagination.pageCount > 1 ? <div className="flex items-center justify-center gap-3 border-t border-slate-100 bg-slate-50 p-3"><Button variant="ghost" disabled={loading || page === 1} onClick={() => void load(query, page - 1)}>前へ</Button><span className="text-xs font-bold text-slate-600">{page} / {data.pagination.pageCount}ページ（全{data.pagination.total}件）</span><Button variant="ghost" disabled={loading || page === data.pagination.pageCount} onClick={() => void load(query, page + 1)}>次へ</Button></div> : null}
      </Card>
    </main>
    <nav aria-label="モバイルメニュー" className="fixed inset-x-3 bottom-3 z-40 grid grid-cols-4 rounded-2xl border border-slate-200 bg-white/95 p-1.5 shadow-2xl md:hidden"><Link href="/" className="grid min-h-12 place-items-center text-[10px] font-bold text-slate-500"><LayoutGrid className="size-4" />駐車場</Link><Link href="/timeline" className="grid min-h-12 place-items-center text-[10px] font-bold text-slate-500"><Clock3 className="size-4" />予定</Link><Link href="/settings/employees" className="grid min-h-12 place-items-center text-[10px] font-bold text-slate-500"><Settings className="size-4" />設定</Link><span className="grid min-h-12 place-items-center rounded-xl bg-slate-900 text-[10px] font-bold text-white"><Archive className="size-4" />履歴</span></nav>
  </div>;
}
