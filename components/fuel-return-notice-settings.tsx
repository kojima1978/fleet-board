"use client";
import { useEffect, useRef, useState } from "react";
import { FUEL_NOTICE_AUDIO_MAX_BYTES, type FuelReturnNotice } from "@/lib/fuel-return-notice";
import { Button, Card } from "./ui";

type Upload = { fileName: string; base64: string };
export function FuelReturnNoticeSettings() {
  const [notices, setNotices] = useState<FuelReturnNotice[]>([]);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const timer = window.setTimeout(() => controller.abort(), 8000);
    setError("");
    void fetch("/api/settings/fuel-return", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error();
      const result = await response.json(); if (!cancelled) setNotices(result.notices);
    }).catch(() => { if (cancelled) return; if (!controller.signal.aborted) setError("案内設定を読み込めませんでした"); else setError("応答を確認できませんでした"); }).finally(() => window.clearTimeout(timer));
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); };
  }, [reload]);
  return <Card className="max-w-[760px] p-4 sm:p-5"><h3 className="text-base font-black">返却時のガソリン残量の案内</h3><p className="mt-1 text-sm text-slate-500">返却を保存した後に案内します。音声は共用端末で1回再生し、各自のPCではメッセージのみ表示します。</p>
    <p className="mt-2 text-xs text-slate-500">音声はMP3・WAV、各2MBまで。設定と音声は全端末で共有し、バックアップにも保存します。</p>
    {error ? <p role="alert" className="mt-3 text-sm text-rose-700">{error}<Button variant="ghost" onClick={() => setReload((value) => value + 1)}>再読み込み</Button></p> : !notices.length ? <p role="status" className="mt-3 text-sm text-slate-500">読み込み中…</p> : null}
    <div className="mt-4 space-y-4">{notices.map((notice) => <NoticeEditor key={`${notice.level}:${notice.version}`} notice={notice} onSaved={(saved) => setNotices((items) => items.map((item) => item.level === saved.level ? saved : item))} />)}</div>
  </Card>;
}
function NoticeEditor({ notice, onSaved }: { notice: FuelReturnNotice; onSaved: (notice: FuelReturnNotice) => void }) {
  const [enabled, setEnabled] = useState(notice.enabled);
  const [message, setMessage] = useState(notice.message);
  const [audio, setAudio] = useState<Upload | null | undefined>();
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const player = useRef<HTMLAudioElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const audioUrl = audio ? `data:audio/${audio.fileName.toLowerCase().endsWith(".wav") ? "wav" : "mpeg"};base64,${audio.base64}` : audio === null ? null : notice.audioUrl;
  const dirty = message !== notice.message || enabled !== notice.enabled || audio !== undefined;
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
    const controller = new AbortController(); const timer = window.setTimeout(() => controller.abort(), 10_000);
    try {
      player.current?.pause();
      const response = await fetch("/api/settings/fuel-return", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ level: notice.level, version: notice.version, enabled, message, ...(audio !== undefined ? { audio } : {}) }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.message);
      onSaved(result.notice);
    } catch (failure) { setError(controller.signal.aborted ? "保存結果を確認できませんでした。再読み込みして確認してください。" : (failure as Error).message); }
    finally { window.clearTimeout(timer); setBusy(false); }
  }
  return <form data-kiosk-auto-home-blocked={dirty || busy || reading} onSubmit={(event) => { event.preventDefault(); if (!busy && !reading && dirty) void save(); }} className="space-y-3 rounded-2xl border border-slate-200 p-4">
    <div className="flex items-center justify-between"><h4 className="font-black">残量 {notice.level === 0 ? "E" : "1/4"}</h4><label className="flex min-h-11 items-center gap-2 text-sm font-bold"><input type="checkbox" checked={enabled} disabled={busy} onChange={(event) => setEnabled(event.target.checked)} />案内を有効にする</label></div>
    <label className="block text-xs font-bold text-slate-600">表示メッセージ<textarea required maxLength={500} rows={3} value={message} disabled={busy} onChange={(event) => setMessage(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-sm text-slate-900" /></label>
    <label className="block text-xs font-bold text-slate-600">音声ファイル<input ref={input} type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" disabled={busy || reading} onChange={(event) => void choose(event.target.files?.[0])} className="mt-2 block w-full min-w-0 text-sm" /></label>
    <p className="break-words text-xs text-slate-500">{reading ? "読み込み中…" : audio?.fileName ?? (audio === null ? "音声なし" : notice.audioName ?? "音声なし")}{audio !== undefined ? "（保存するまで反映されません）" : ""}</p>
    {audioUrl ? <><audio ref={player} controls preload="none" src={audioUrl} className="w-full" /><div className="flex flex-wrap gap-2"><Button type="button" variant="ghost" disabled={busy || reading} onClick={() => { if (player.current) { player.current.currentTime = 0; void player.current.play().catch(() => setError("音声を再生できません。MP3・WAVの内容をご確認ください。")); } }}>試聴</Button><Button type="button" variant="ghost" disabled={busy || reading} onClick={() => { player.current?.pause(); setAudio(null); if (input.current) input.current.value = ""; }}>音声を外す</Button></div></> : null}
    {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
    <Button type="submit" disabled={busy || reading || !dirty || !message.trim()}>{busy ? "保存中…" : "この案内を保存"}</Button>
    {!dirty && notice.version > 0 ? <p role="status" className="text-xs font-bold text-emerald-700">保存済み</p> : null}
  </form>;
}
