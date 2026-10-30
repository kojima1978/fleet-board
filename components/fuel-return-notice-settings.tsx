"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Fuel, LoaderCircle, Play, Save, Trash2, Upload, Volume2, VolumeX } from "lucide-react";
import { FUEL_NOTICE_AUDIO_MAX_BYTES, type FuelReturnNotice } from "@/lib/fuel-return-notice";
import { formatFuelLevel } from "@/lib/fuel-level";
import { Button, Card, cn } from "./ui";

type UploadFile = { fileName: string; base64: string };

export function FuelReturnNoticeSettings() {
  const [notices, setNotices] = useState<FuelReturnNotice[]>([]);
  const [selectedLevel, setSelectedLevel] = useState(1);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const timer = window.setTimeout(() => controller.abort(), 8000);
    setError("");
    void fetch("/api/settings/fuel-return", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (!cancelled) setNotices(result.notices);
    }).catch(() => {
      if (!cancelled) setError(controller.signal.aborted ? "応答を確認できませんでした" : "案内設定を読み込めませんでした");
    }).finally(() => window.clearTimeout(timer));
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); };
  }, [reload]);

  const enabledCount = notices.filter((notice) => notice.enabled).length;
  return <Card className="w-full max-w-[900px] overflow-hidden border-slate-200 bg-white p-0">
    <div className="flex flex-wrap items-start gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600"><Fuel className="size-5" /></span>
      <div className="mr-auto min-w-0"><h3 className="text-base font-black text-slate-900">ガソリン残量別の案内</h3><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">返却を保存した後、選択された残量の案内を表示します。音声は共用端末だけで1回再生します。</p></div>
      {notices.length ? <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-600">5段階中 {enabledCount}件を使用</span> : null}
    </div>
    {error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 text-sm text-rose-700 sm:px-5"><span>{error}</span><Button variant="secondary" onClick={() => setReload((value) => value + 1)}>再読み込み</Button></div> : null}
    {!error && !notices.length ? <div role="status" className="flex items-center gap-2 px-5 py-8 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin" />設定を読み込んでいます</div> : null}
    {notices.length ? <div role="tablist" aria-label="ガソリン残量" className="grid grid-cols-5 gap-1 border-b border-slate-100 bg-slate-50/70 p-2 sm:gap-2 sm:px-5">{notices.map((notice) => <button key={notice.level} type="button" role="tab" aria-selected={selectedLevel === notice.level} aria-controls={`fuel-notice-panel-${notice.level}`} onClick={() => setSelectedLevel(notice.level)} className={cn("flex min-h-12 items-center justify-center gap-1.5 rounded-xl border text-sm font-black transition", selectedLevel === notice.level ? "border-slate-300 bg-white text-slate-900 shadow-sm" : "border-transparent text-slate-500 hover:border-slate-200 hover:bg-white")}><span className={cn("size-2 rounded-full", notice.enabled ? "bg-emerald-500" : "bg-slate-300")} /><span className="tabular-nums">{formatFuelLevel(notice.level)}</span><span className="hidden text-[10px] font-bold sm:inline">{notice.enabled ? "ON" : "OFF"}</span></button>)}</div> : null}
    <div>{notices.map((notice) => <div key={notice.level} id={`fuel-notice-panel-${notice.level}`} role="tabpanel" hidden={selectedLevel !== notice.level}><NoticeEditor key={`${notice.level}:${notice.version}`} notice={notice} onSaved={(saved) => setNotices((items) => items.map((item) => item.level === saved.level ? saved : item))} /></div>)}</div>
    <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-3 text-xs leading-5 text-slate-500 sm:px-5">音声はMP3・WAV（各2MBまで）に対応しています。設定は全端末で共有され、JSONバックアップにも保存されます。</div>
  </Card>;
}

function NoticeEditor({ notice, onSaved }: { notice: FuelReturnNotice; onSaved: (notice: FuelReturnNotice) => void }) {
  const [enabled, setEnabled] = useState(notice.enabled);
  const [animated, setAnimated] = useState(notice.animated);
  const [message, setMessage] = useState(notice.message);
  const [audio, setAudio] = useState<UploadFile | null | undefined>();
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const player = useRef<HTMLAudioElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const levelLabel = formatFuelLevel(notice.level);
  const audioUrl = audio ? `data:audio/${audio.fileName.toLowerCase().endsWith(".wav") ? "wav" : "mpeg"};base64,${audio.base64}` : audio === null ? null : notice.audioUrl;
  const audioName = reading ? "読み込み中…" : audio?.fileName ?? (audio === null ? "音声なし" : notice.audioName ?? "音声なし");
  const dirty = message !== notice.message || enabled !== notice.enabled || animated !== notice.animated || audio !== undefined;

  useEffect(() => { const element = player.current; return () => { element?.pause(); }; }, [audioUrl]);

  async function choose(file?: File) {
    setError("");
    if (!file) return;
    if (file.size > FUEL_NOTICE_AUDIO_MAX_BYTES || !file.size || !/\.(mp3|wav)$/i.test(file.name)) { setError("2MB以内のMP3・WAVを選んでください"); if (input.current) input.current.value = ""; return; }
    setReading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
      setAudio({ fileName: file.name.slice(0, 100), base64: dataUrl.slice(dataUrl.indexOf(",") + 1) });
    } catch { setError("音声ファイルを読み込めませんでした"); }
    finally { setReading(false); }
  }

  async function save() {
    setBusy(true); setError("");
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 10_000);
    try {
      player.current?.pause();
      const response = await fetch("/api/settings/fuel-return", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ level: notice.level, version: notice.version, enabled, animated, message, ...(audio !== undefined ? { audio } : {}) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      onSaved(result.notice);
    } catch (failure) { setError(controller.signal.aborted ? "保存結果を確認できませんでした。再読み込みして確認してください。" : (failure as Error).message); }
    finally { window.clearTimeout(timer); setBusy(false); }
  }

  return <form data-kiosk-auto-home-blocked={dirty || busy || reading} onSubmit={(event) => { event.preventDefault(); if (!busy && !reading && dirty) void save(); }} className="px-4 py-5 sm:px-5">
    <div className="grid gap-4 lg:grid-cols-2">
      <div><button type="button" role="switch" aria-checked={animated} disabled={busy} onClick={() => setAnimated((value) => !value)} className={cn("flex min-h-10 w-32 items-center justify-center gap-2 whitespace-nowrap rounded-lg border px-2 text-xs font-bold transition disabled:opacity-60", animated ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50")}><span className={cn("relative h-5 w-9 shrink-0 rounded-full transition", animated ? "bg-blue-600" : "bg-slate-200")}><span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition", animated ? "left-[18px]" : "left-0.5")} /></span>{animated ? "強調あり" : "強調なし"}</button><label className="mt-3 block text-xs font-bold text-slate-600">表示メッセージ<textarea required maxLength={500} value={message} disabled={busy} onChange={(event) => setMessage(event.target.value)} className="mt-1.5 h-40 w-full resize-none rounded-xl border border-slate-300 bg-white p-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50" /></label></div>
      <div><button type="button" role="switch" aria-checked={enabled} disabled={busy} onClick={() => setEnabled((value) => !value)} className={cn("flex min-h-10 w-32 items-center justify-center gap-2 whitespace-nowrap rounded-lg border px-2 text-xs font-bold transition disabled:opacity-60", enabled ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50")}><span className={cn("relative h-5 w-9 shrink-0 rounded-full transition", enabled ? "bg-blue-600" : "bg-slate-200")}><span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition", enabled ? "left-[18px]" : "left-0.5")} /></span>{enabled ? "案内あり" : "案内なし"}</button><p className="mt-3 text-xs font-bold text-slate-600">音声案内</p><div onDragEnter={(event) => { event.preventDefault(); if (!busy && !reading) setDragging(true); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; if (!busy && !reading) setDragging(true); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); if (busy || reading) return; const files = [...event.dataTransfer.files]; if (files.length !== 1) { setError("音声ファイルを1つだけドロップしてください"); return; } void choose(files[0]); }} className={cn("mt-1.5 flex h-40 flex-col rounded-xl border border-slate-200 bg-slate-50/70 p-3 transition", dragging && "border-blue-400 bg-blue-50 ring-2 ring-blue-100")}>
        <div className="flex min-w-0 items-center gap-2"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white text-slate-500 shadow-sm">{audioUrl ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}</span><span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-700" title={audioName}>{audioName}</span></div>
        <p className={cn("mt-2 text-[11px] font-bold", dragging ? "text-blue-700" : "text-slate-500")}>{dragging ? "ここにドロップしてください" : "MP3・WAVをここへドロップ、またはファイルを選択"}</p>
        {audio !== undefined ? <p className="mt-2 text-[11px] font-bold text-amber-700">保存すると反映されます</p> : null}
        <input ref={input} type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" disabled={busy || reading} onChange={(event) => void choose(event.target.files?.[0])} className="sr-only" />
        <div className="mt-auto flex flex-wrap gap-2 pt-3"><Button type="button" variant="ghost" className="min-h-9 rounded-lg px-3 text-xs" disabled={busy || reading} onClick={() => input.current?.click()}><Upload className="size-3.5" />{audioUrl ? "音声を変更" : "音声を選択"}</Button>{audioUrl ? <Button type="button" variant="ghost" className="min-h-9 rounded-lg px-3 text-xs" disabled={busy || reading} onClick={() => { if (player.current) { player.current.currentTime = 0; void player.current.play().catch(() => setError("音声を再生できません。MP3・WAVの内容をご確認ください。")); } }}><Play className="size-3.5" />試聴</Button> : null}{audioUrl ? <Button type="button" variant="ghost" className="min-h-9 rounded-lg px-3 text-xs" disabled={busy || reading} onClick={() => { player.current?.pause(); setAudio(null); if (input.current) input.current.value = ""; }}><Trash2 className="size-3.5" />外す</Button> : null}</div>
        {audioUrl ? <audio ref={player} preload="none" src={audioUrl} className="hidden" /> : null}
      </div></div>
    </div>

    <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
      {error ? <p role="alert" className="mr-auto text-sm font-bold text-rose-700">{error}</p> : <p aria-live="polite" className="mr-auto flex items-center gap-1.5 text-xs font-bold text-slate-500">{dirty ? "未保存の変更があります" : notice.version > 0 ? <><Check className="size-4 text-emerald-600" />保存済み</> : "初期設定"}</p>}
      <Button type="submit" disabled={busy || reading || !dirty || !message.trim()}><Save className="size-4" />{busy ? "保存中…" : `残量 ${levelLabel} の設定を保存`}</Button>
    </div>
  </form>;
}
