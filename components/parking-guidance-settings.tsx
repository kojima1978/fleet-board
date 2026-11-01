"use client";

import { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, MapPin, Play, RotateCcw, Save, Trash2, Upload, Volume2, VolumeX } from "lucide-react";
import { PARKING_GUIDANCE_AUDIO_MAX_BYTES, parkingGuidanceLabels, type ParkingGuidanceEvent, type ParkingGuidanceSetting } from "@/lib/parking-guidance";
import { refreshParkingGuidance } from "@/lib/use-parking-guidance";
import { Button, Card, cn } from "./ui";

type UploadFile = { fileName: string; base64: string };

export function ParkingGuidanceSettings() {
  const [settings, setSettings] = useState<ParkingGuidanceSetting[]>([]);
  const [selected, setSelected] = useState<ParkingGuidanceEvent>("DEPARTURE");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [resetting, setResetting] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setError(""); setSettings([]);
    void fetch("/api/settings/parking-guidance", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error();
      setSettings((await response.json()).settings);
    }).catch(() => { if (!controller.signal.aborted) setError("駐車音声案内を読み込めませんでした"); });
    return () => controller.abort();
  }, [reload]);
  async function resetDefaults() {
    if (!window.confirm("駐車案内5項目の文面・ON/OFF・音声を初期設定へ戻します。未保存の変更も破棄されます。よろしいですか？")) return;
    setResetting(true); setError("");
    try {
      const response = await fetch("/api/settings/parking-guidance/reset", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      setSettings(result.settings); refreshParkingGuidance();
    } catch (failure) { setError((failure as Error).message || "初期設定へ戻せませんでした"); }
    finally { setResetting(false); }
  }
  const setting = settings.find((item) => item.event === selected);
  return <Card data-kiosk-auto-home-blocked={resetting} className="w-full max-w-[900px] overflow-hidden border-slate-200 bg-white p-0">
    <div className="flex flex-wrap items-start gap-3 border-b border-slate-100 px-4 py-4 sm:px-5"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600"><MapPin className="size-5" /></span><div className="mr-auto min-w-0"><h3 className="text-base font-black text-slate-900">駐車操作の音声案内</h3><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">出庫・入庫・区画選択と、手前の車で動かせない場面を個別に案内します。</p></div>{settings.length ? <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-600">{settings.filter((item) => item.enabled).length}/{settings.length}件 ON</span> : null}<Button type="button" variant="ghost" className="min-h-7 gap-1 rounded-lg border-slate-300 px-2 text-[11px] text-slate-800" disabled={resetting || !settings.length} onClick={() => void resetDefaults()}>{resetting ? <LoaderCircle className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}{resetting ? "戻しています…" : "初期設定に戻す"}</Button></div>
    {error ? <div role="alert" className="flex items-center justify-between gap-3 p-5 text-sm font-bold text-rose-700"><span>{error}</span><Button variant="secondary" onClick={() => setReload((value) => value + 1)}>再読み込み</Button></div> : null}
    {!error && !settings.length ? <div role="status" className="flex items-center gap-2 p-8 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin" />設定を読み込んでいます</div> : null}
    {settings.length ? <><div role="tablist" aria-label="駐車音声の場面" className="grid grid-cols-2 gap-1 border-b border-slate-100 bg-slate-50/70 p-2 sm:grid-cols-5 sm:px-4">{settings.map((item) => <button key={item.event} type="button" role="tab" aria-selected={selected === item.event} onClick={() => setSelected(item.event)} className={cn("min-h-12 rounded-xl border px-2 text-xs font-black transition", selected === item.event ? "border-slate-300 bg-white text-slate-900 shadow-sm" : "border-transparent text-slate-500 hover:bg-white")}><span className={cn("mr-1.5 inline-block size-2 rounded-full", item.enabled ? "bg-emerald-500" : "bg-slate-300")} />{parkingGuidanceLabels[item.event].label}</button>)}</div>{setting ? <GuidanceEditor key={`${setting.event}:${setting.version}`} setting={setting} onSaved={(saved) => setSettings((items) => items.map((item) => item.event === saved.event ? saved : item))} /> : null}</> : null}
    <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-3 text-xs leading-5 text-slate-500 sm:px-5">音声ファイルが未登録なら端末の日本語読み上げを使用します。MP3・WAV（2MBまで）を登録すると、その音声を優先します。</div>
  </Card>;
}

function GuidanceEditor({ setting, onSaved }: { setting: ParkingGuidanceSetting; onSaved: (setting: ParkingGuidanceSetting) => void }) {
  const [enabled, setEnabled] = useState(setting.enabled);
  const [message, setMessage] = useState(setting.message);
  const [audio, setAudio] = useState<UploadFile | null | undefined>();
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const player = useRef<HTMLAudioElement>(null);
  const audioUrl = audio ? `data:audio/${audio.fileName.toLowerCase().endsWith(".wav") ? "wav" : "mpeg"};base64,${audio.base64}` : audio === null ? null : setting.audioUrl;
  const audioName = reading ? "読み込み中…" : audio?.fileName ?? (audio === null ? "端末の読み上げを使用" : setting.audioName ?? "端末の読み上げを使用");
  const dirty = enabled !== setting.enabled || message !== setting.message || audio !== undefined;
  async function choose(file?: File) {
    setError("");
    if (!file) return;
    if (!file.size || file.size > PARKING_GUIDANCE_AUDIO_MAX_BYTES || !/\.(mp3|wav)$/i.test(file.name)) { setError("2MB以内のMP3・WAVを選んでください"); return; }
    setReading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
      setAudio({ fileName: file.name.slice(0, 100), base64: dataUrl.slice(dataUrl.indexOf(",") + 1) });
    } catch { setError("音声ファイルを読み込めませんでした"); }
    finally { setReading(false); }
  }
  async function save() {
    setBusy(true); setError(""); player.current?.pause();
    try {
      const response = await fetch("/api/settings/parking-guidance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: setting.event, version: setting.version, enabled, message, ...(audio !== undefined ? { audio } : {}) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      refreshParkingGuidance(); onSaved(result.setting); setAudio(undefined);
    } catch (failure) { setError((failure as Error).message || "設定を保存できませんでした"); }
    finally { setBusy(false); }
  }
  const preview = () => {
    if (audioUrl && player.current) { player.current.currentTime = 0; void player.current.play().catch(() => setError("音声を再生できません")); return; }
    if ("speechSynthesis" in window) { window.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(message); utterance.lang = "ja-JP"; window.speechSynthesis.speak(utterance); }
  };
  return <form data-kiosk-auto-home-blocked={dirty || busy || reading} onSubmit={(event) => { event.preventDefault(); if (dirty && message.trim()) void save(); }} className="px-4 py-5 sm:px-5">
    <div className="mb-4 flex items-start gap-3"><div className="mr-auto min-w-0"><h4 className="text-sm font-black text-slate-900">{parkingGuidanceLabels[setting.event].label}</h4><p className="mt-1 text-xs text-slate-500">{parkingGuidanceLabels[setting.event].hint}</p></div><button type="button" role="switch" aria-checked={enabled} disabled={busy} onClick={() => setEnabled((value) => !value)} className={cn("flex min-h-9 w-28 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-2 text-xs font-bold", enabled ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-500")}><span className={cn("relative h-4 w-7 shrink-0 rounded-full", enabled ? "bg-blue-600" : "bg-slate-200")}><span className={cn("absolute top-0.5 size-3 rounded-full bg-white shadow-sm transition", enabled ? "left-[14px]" : "left-0.5")} /></span><span>{enabled ? "案内あり" : "案内なし"}</span></button></div>
    <div className="grid gap-4 lg:grid-cols-2"><div><p className="mb-1.5 text-xs font-bold text-slate-600">読み上げ文</p><textarea aria-label="読み上げ文" required maxLength={300} value={message} disabled={busy} onChange={(event) => setMessage(event.target.value)} className="h-40 w-full resize-none rounded-xl border border-slate-300 p-3 text-sm leading-6 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200" /></div><div><p className="mb-1.5 text-xs font-bold text-slate-600">音声ファイル（任意）</p><div onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDragging(true); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); const files = [...event.dataTransfer.files]; if (files.length === 1) void choose(files[0]); else setError("音声ファイルを1つだけドロップしてください"); }} className={cn("flex h-40 flex-col rounded-xl border border-slate-200 bg-slate-50/70 p-3", dragging && "border-blue-400 bg-blue-50 ring-2 ring-blue-100")}><div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-lg bg-white text-slate-500 shadow-sm">{audioUrl ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}</span><span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-700">{audioName}</span></div><p className="mt-2 text-[11px] font-bold text-slate-500">MP3・WAVをドロップ、またはファイルを選択</p><input ref={input} type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" className="sr-only" onChange={(event) => void choose(event.target.files?.[0])} /><div className="mt-auto flex flex-wrap gap-2"><Button type="button" variant="ghost" className="min-h-9 px-3 text-xs" onClick={() => input.current?.click()}><Upload className="size-3.5" />{audioUrl ? "音声を変更" : "音声を選択"}</Button><Button type="button" variant="ghost" className="min-h-9 px-3 text-xs" onClick={preview}><Play className="size-3.5" />試聴</Button>{audioUrl ? <Button type="button" variant="ghost" className="min-h-9 px-3 text-xs" onClick={() => { player.current?.pause(); setAudio(null); }}><Trash2 className="size-3.5" />外す</Button> : null}</div>{audioUrl ? <audio ref={player} preload="none" src={audioUrl} className="hidden" /> : null}</div></div></div>
    <div className="mt-4 flex items-center gap-3 border-t border-slate-100 pt-4">{error ? <p role="alert" className="mr-auto text-sm font-bold text-rose-700">{error}</p> : <p className="mr-auto flex items-center gap-1.5 text-xs font-bold text-slate-500">{dirty ? "未保存の変更があります" : <><Check className="size-4 text-emerald-600" />保存済み</>}</p>}<Button type="submit" disabled={busy || reading || !dirty || !message.trim()}><Save className="size-4" />{busy ? "保存中…" : "この案内を保存"}</Button></div>
  </form>;
}
