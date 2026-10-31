"use client";
import { useEffect, useRef } from "react";
import type { FuelReturnNotice } from "@/lib/fuel-return-notice";
import { isNfcSoundEnabled } from "@/lib/device-mode";
import { beginFuelGuidance, endFuelGuidance } from "@/lib/guidance-audio-priority";
import { cn } from "./ui";

export function FuelReturnNoticeMessage({ notice, kiosk, compact = false, onAudioPlaybackChange }: { notice: FuelReturnNotice; kiosk: boolean; compact?: boolean; onAudioPlaybackChange?: (playing: boolean) => void }) {
  const player = useRef<HTMLAudioElement>(null);
  const withAudio = kiosk && notice.audioEnabled && isNfcSoundEnabled() && !!notice.audioUrl;
  useEffect(() => {
    const audio = player.current;
    if (!audio) return;
    beginFuelGuidance(audio);
    const timer = window.setTimeout(() => { void audio.play().catch(() => endFuelGuidance(audio)); }, 0);
    return () => { window.clearTimeout(timer); audio.pause(); endFuelGuidance(audio); };
  }, []);
  return <div className={compact ? "space-y-0" : "space-y-4"}>{compact ? null : <p className={cn("text-sm font-bold", notice.phase === "START" ? "text-amber-800" : "text-emerald-700")}>{notice.phase === "START" ? "給油についてのご案内" : "返却の登録が完了しました。"}</p>}<p className={cn("whitespace-pre-wrap break-words font-bold text-slate-900", compact ? "text-sm leading-5" : "rounded-xl border border-amber-200 bg-amber-50 p-4 text-base leading-relaxed", !compact && notice.displayMode !== "MESSAGE" && "fuel-reminder-attention")}>{notice.message}</p>{withAudio ? <div className={compact ? "sr-only" : undefined}><audio ref={player} controls={!compact} preload="auto" src={notice.audioUrl!} onPlay={(event) => { beginFuelGuidance(event.currentTarget); onAudioPlaybackChange?.(true); }} onPause={(event) => { endFuelGuidance(event.currentTarget); onAudioPlaybackChange?.(false); }} onEnded={(event) => { endFuelGuidance(event.currentTarget); onAudioPlaybackChange?.(false); }} className={compact ? undefined : "w-full"} />{compact ? null : <p className="mt-2 text-xs text-slate-500">音声が流れない場合は、再生ボタンを押してください。</p>}</div> : null}</div>;
}
