"use client";
import { useEffect, useRef } from "react";
import type { FuelReturnNotice } from "@/lib/fuel-return-notice";
import { isNfcSoundEnabled } from "@/lib/device-mode";
import { cn } from "./ui";

export function FuelReturnNoticeMessage({ notice, kiosk }: { notice: FuelReturnNotice; kiosk: boolean }) {
  const player = useRef<HTMLAudioElement>(null);
  const withAudio = kiosk && isNfcSoundEnabled() && !!notice.audioUrl;
  useEffect(() => {
    const audio = player.current;
    const timer = window.setTimeout(() => { if (audio) void audio.play().catch(() => {}); }, 0);
    return () => { window.clearTimeout(timer); audio?.pause(); };
  }, []);
  return <div className="space-y-4"><p className="text-sm font-bold text-emerald-700">返却の登録が完了しました。</p><p className={cn("whitespace-pre-wrap break-words rounded-xl border border-amber-200 bg-amber-50 p-4 text-base font-bold leading-relaxed text-slate-900", notice.animated && "fuel-reminder-attention")}>{notice.message}</p>{withAudio ? <div><audio ref={player} controls preload="auto" src={notice.audioUrl!} className="w-full" /><p className="mt-2 text-xs text-slate-500">音声が流れない場合は、再生ボタンを押してください。</p></div> : null}</div>;
}
