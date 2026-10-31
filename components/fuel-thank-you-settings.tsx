"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Gift, LoaderCircle, Play, Save, Trash2, Upload, Volume2, VolumeX } from "lucide-react";
import { FUEL_NOTICE_AUDIO_MAX_BYTES } from "@/lib/fuel-return-notice";
import type { FuelThankYouSetting } from "@/lib/fuel-thank-you";
import { Button, cn } from "./ui";

type UploadFile = { fileName: string; base64: string };

export function FuelThankYouSettings() {
  const [setting, setSetting] = useState<FuelThankYouSetting | null>(null);
  const [reload, setReload] = useState(0);
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoadError(""); setSetting(null);
    void fetch("/api/settings/fuel-thank-you", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error();
      setSetting((await response.json()).setting);
    }).catch(() => { if (!controller.signal.aborted) setLoadError("給油時のお礼設定を読み込めませんでした"); });
    return () => controller.abort();
  }, [reload]);
  if (loadError) return <div role="alert" className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 text-sm font-bold text-rose-700"><span>{loadError}</span><Button variant="secondary" onClick={() => setReload((value) => value + 1)}>再読み込み</Button></div>;
  if (!setting) return <div role="status" className="flex items-center gap-2 border-b border-slate-100 px-5 py-5 text-sm text-slate-500"><LoaderCircle className="size-4 animate-spin" />給油時のお礼を読み込んでいます</div>;
  return <ThankYouEditor key={setting.version} setting={setting} onSaved={setSetting} />;
}

function ThankYouEditor({ setting, onSaved }: { setting: FuelThankYouSetting; onSaved: (setting: FuelThankYouSetting) => void }) {
  const [enabled, setEnabled] = useState(setting.enabled);
  const [audioEnabled, setAudioEnabled] = useState(setting.audioEnabled);
  const [message, setMessage] = useState(setting.message);
  const [audio, setAudio] = useState<UploadFile | null | undefined>();
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const player = useRef<HTMLAudioElement>(null);
  const audioUrl = audio ? `data:audio/${audio.fileName.toLowerCase().endsWith(".wav") ? "wav" : "mpeg"};base64,${audio.base64}` : audio === null ? null : setting.audioUrl;
  const audioName = reading ? "読み込み中…" : audio?.fileName ?? (audio === null ? "音声なし" : setting.audioName ?? "音声なし");
  const dirty = enabled !== setting.enabled || audioEnabled !== setting.audioEnabled || message !== setting.message || audio !== undefined;

  async function choose(file?: File) {
    setError("");
    if (!file) return;
    if (!file.size || file.size > FUEL_NOTICE_AUDIO_MAX_BYTES || !/\.(mp3|wav)$/i.test(file.name)) { setError("2MB以内のMP3・WAVを選んでください"); return; }
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
      const response = await fetch("/api/settings/fuel-thank-you", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: setting.version, enabled, audioEnabled, message, ...(audio !== undefined ? { audio } : {}) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      onSaved(result.setting); setAudio(undefined);
    } catch (failure) { setError((failure as Error).message || "設定を保存できませんでした"); }
    finally { setBusy(false); }
  }

  return <form data-kiosk-auto-home-blocked={dirty || busy || reading} onSubmit={(event) => { event.preventDefault(); if (dirty && message.trim()) void save(); }} className="border-b border-slate-100 bg-emerald-50/30 px-4 py-4 sm:px-5">
    <div className="mb-3 flex items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white text-emerald-700 shadow-sm"><Gift className="size-4" /></span><div className="mr-auto min-w-0"><p className="text-sm font-black text-slate-900">給油時のお礼</p><p className="mt-0.5 text-[11px] leading-4 text-slate-500">出庫時より残量が増えて返却された場合に表示します</p></div><button type="button" role="switch" aria-checked={enabled} disabled={busy} onClick={() => setEnabled((value) => !value)} className={cn("flex min-h-8 w-28 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-2 text-xs font-bold", enabled ? "border-emerald-200 bg-white text-emerald-700" : "border-slate-200 bg-white text-slate-500")}><span className={cn("relative h-4 w-7 shrink-0 rounded-full", enabled ? "bg-emerald-600" : "bg-slate-200")}><span className={cn("absolute top-0.5 size-3 rounded-full bg-white shadow-sm transition", enabled ? "left-[14px]" : "left-0.5")} /></span>{enabled ? "お礼あり" : "お礼なし"}</button></div>
    <div className="grid gap-3 lg:grid-cols-2"><div><p className="mb-1.5 text-xs font-bold text-slate-600">お礼メッセージ</p><textarea aria-label="給油時のお礼メッセージ" required maxLength={300} value={message} disabled={busy} onChange={(event) => setMessage(event.target.value)} className="h-36 w-full resize-none rounded-xl border border-slate-300 bg-white p-3 text-sm leading-6 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" /></div><div><div className="mb-1.5 flex min-h-6 items-center justify-between gap-2"><p className="text-xs font-bold text-slate-600">お礼の音声（任意）</p><button type="button" role="switch" aria-checked={audioEnabled} disabled={busy} onClick={() => setAudioEnabled((value) => !value)} className="shrink-0 whitespace-nowrap text-xs font-bold text-slate-600">{audioEnabled ? "音声あり" : "音声なし"}</button></div><div onDragEnter={(event) => { event.preventDefault(); if (!busy && !reading) setDragging(true); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; if (!busy && !reading) setDragging(true); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); if (busy || reading) return; const files = [...event.dataTransfer.files]; if (files.length !== 1) { setError("音声ファイルを1つだけドロップしてください"); return; } void choose(files[0]); }} className={cn("flex h-36 flex-col rounded-xl border border-slate-200 bg-white p-3 transition", dragging && "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-100")}><div className="flex min-w-0 items-center gap-2"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-slate-50 text-slate-500">{audioUrl ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}</span><span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-700" title={audioName}>{audioName}</span></div><p className={cn("mt-2 text-[11px] font-bold", dragging ? "text-emerald-700" : "text-slate-500")}>{dragging ? "ここにドロップしてください" : "MP3・WAVをここへドロップ、またはファイルを選択"}</p>{audio !== undefined ? <p className="mt-1 text-[11px] font-bold text-amber-700">保存すると反映されます</p> : null}<input ref={input} type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" disabled={busy || reading} className="sr-only" onChange={(event) => void choose(event.target.files?.[0])} /><div className="mt-auto flex flex-wrap gap-2"><Button type="button" variant="ghost" className="min-h-8 px-2 text-xs" disabled={busy || reading} onClick={() => input.current?.click()}><Upload className="size-3.5" />{audioUrl ? "音声を変更" : "音声を選択"}</Button>{audioUrl ? <Button type="button" variant="ghost" className="min-h-8 px-2 text-xs" disabled={busy || reading} onClick={() => { if (player.current) { player.current.currentTime = 0; void player.current.play().catch(() => setError("音声を再生できません。MP3・WAVの内容をご確認ください。")); } }}><Play className="size-3.5" />試聴</Button> : null}{audioUrl ? <Button type="button" variant="ghost" className="min-h-8 px-2 text-xs" disabled={busy || reading} onClick={() => { player.current?.pause(); setAudio(null); if (input.current) input.current.value = ""; }}><Trash2 className="size-3.5" />外す</Button> : null}</div>{audioUrl ? <audio ref={player} preload="none" src={audioUrl} className="hidden" /> : null}</div></div></div>
    <div className="mt-3 flex items-center gap-3">{error ? <p role="alert" className="mr-auto text-xs font-bold text-rose-700">{error}</p> : <p className="mr-auto flex items-center gap-1.5 text-xs font-bold text-slate-500">{dirty ? "未保存の変更があります" : <><Check className="size-4 text-emerald-600" />保存済み</>}</p>}<Button type="submit" disabled={busy || reading || !dirty || !message.trim()}><Save className="size-4" />{busy ? "保存中…" : "お礼設定を保存"}</Button></div>
  </form>;
}
