"use client";
import { useEffect, useRef, useState } from "react";
import { readSavedEmployee } from "@/lib/employee-session";
import { createOperationId } from "@/lib/operation-id";
import type { StartTimeRecord } from "@/lib/trip-times";
import { ActualStartEditor } from "./trip-start-editors";
import { Button } from "./ui";

export function StartTimeHistory({ onSaved }: { onSaved: () => void }) {
  const [records, setRecords] = useState<StartTimeRecord[]>([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<{ key: string; id: string } | null>(null);
  const requestSequence = useRef(0);
  const actor = readSavedEmployee();
  async function load(search = query, requestedPage = page) {
    const sequence = ++requestSequence.current;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/trips/start-time?q=${encodeURIComponent(search)}&page=${requestedPage}`, { cache: "no-store" });
      if (!response.ok) throw new Error("利用記録を取得できませんでした");
      const data = await response.json();
      if (sequence !== requestSequence.current) return;
      setRecords(data.records); setPage(requestedPage); setPages(data.pages); setSelected(null);
    } catch (failure) { if (sequence === requestSequence.current) setError((failure as Error).message); }
    finally { if (sequence === requestSequence.current) setLoading(false); }
  }
  useEffect(() => { void load("", 1); return () => { requestSequence.current++; }; }, []);
  async function save(trip: StartTimeRecord, actualStart: string, reason: string) {
    if (busy || !actor?.id) return false;
    setBusy(true); setError("");
    const key = JSON.stringify([trip.id, trip.version, actualStart, reason]);
    if (pending.current?.key !== key) pending.current = { key, id: createOperationId() };
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch("/api/dashboard", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ action: "correctActualStart", operationId: pending.current.id, tripId: trip.id, version: trip.version, actualStart, reason, actorEmployeeId: actor.id }) });
      const result = await response.json();
      if (response.status === 409) { await load(); setError(result.message); return false; }
      if (!response.ok) throw new Error(result.message ?? "訂正できませんでした");
      pending.current = null;
      await load(); onSaved(); return true;
    } catch (failure) { setError((failure as Error).name === "AbortError" ? "応答を確認できませんでした。同じ内容で再試行できます。" : (failure as Error).message); return false; }
    finally { window.clearTimeout(timeout); setBusy(false); }
  }
  return <section className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
    <h3 className="text-sm font-black">利用開始時刻の訂正（利用中・返却済み）</h3>
    <div className="mt-3 flex gap-2"><input aria-label="訂正する利用記録を検索" placeholder="車両名・利用者名" value={query} onChange={(event) => setQuery(event.target.value)} className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm" /><Button disabled={busy || loading} onClick={() => void load(query, 1)}>検索</Button></div>
    {error ? <p role="alert" className="mt-3 text-sm font-bold text-rose-700">{error}</p> : null}
    <ul className="mt-3 divide-y divide-slate-100">{records.map((trip) => <li key={trip.id} className="py-3"><button disabled={busy || loading} aria-expanded={selected === trip.id} onClick={() => setSelected(selected === trip.id ? null : trip.id)} className="w-full text-left text-sm"><b>{trip.vehicle.name}</b> ・ {trip.employee.name}<span className="block text-xs text-slate-500">{new Date(trip.actualStart!).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} ・ {trip.status === "IN_USE" ? "利用中" : "返却済み"}</span></button>{selected === trip.id ? <div className="mt-3"><ActualStartEditor key={`${trip.id}-${trip.version}`} trip={trip} busy={busy} actorAvailable={!!actor?.id} onSave={(value, reason) => save(trip, value, reason)} /></div> : null}</li>)}</ul>
    {!loading && !records.length ? <p className="py-4 text-xs text-slate-500">対象の利用記録はありません</p> : null}
    <div className="mt-3 flex items-center justify-center gap-3"><Button variant="ghost" disabled={busy || loading || page <= 1} onClick={() => void load(query, page - 1)}>前へ</Button><span className="text-xs">{page} / {pages}</span><Button variant="ghost" disabled={busy || loading || page >= pages} onClick={() => void load(query, page + 1)}>次へ</Button></div>
  </section>;
}
