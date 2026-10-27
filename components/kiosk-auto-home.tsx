"use client";

import { useEffect, useRef, useState } from "react";
import { useUserTimeoutMinutes } from "@/lib/device-mode";
import { clearSavedEmployee } from "@/lib/employee-session";
import { createAutoHomeTimer } from "@/lib/kiosk-auto-home";
import { ACTIVITY_EVENT, reportActivity } from "./idle-traffic";

export function KioskAutoHome({ enabled, blocked = false }: { enabled: boolean; blocked?: boolean }) {
  const minutes = useUserTimeoutMinutes();
  const [seconds, setSeconds] = useState<number | null>(null);
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  useEffect(() => {
    if (!enabled) { setSeconds(null); return; }
    const originals = new Map<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, string>();
    const control = (target: EventTarget | null) => target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement ? target : null;
    const value = (input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) => input instanceof HTMLInputElement && ["checkbox", "radio"].includes(input.type) ? String(input.checked) : input.value;
    const remember = (event: Event) => {
      const input = control(event.target);
      if (input?.closest("form") && !originals.has(input)) originals.set(input, value(input));
    };
    const protectedNow = () => {
      if (blockedRef.current || document.querySelector('[role="dialog"], [role="alertdialog"], dialog[open], [data-kiosk-auto-home-blocked="true"]')) return true;
      const focused = control(document.activeElement);
      if (focused && !focused.disabled && !focused.matches('[readonly], [type="search"], [type="button"], [type="submit"]')) return true;
      for (const [input, original] of originals) {
        if (!input.isConnected) originals.delete(input);
        else if (value(input) !== original) return true;
      }
      return false;
    };
    const timer = createAutoHomeTimer({ idleMs: minutes * 60_000, now: Date.now, blocked: protectedNow, warn: setSeconds,
      goHome: () => { clearSavedEmployee(); window.location.assign("/?idle=1"); },
    });
    const activity = () => timer.activity();
    const tick = () => timer.tick();
    const events = ["pointerdown", "pointermove", "keydown", "input", "wheel", "touchstart", ACTIVITY_EVENT];
    events.forEach((event) => window.addEventListener(event, activity, { passive: true, capture: true }));
    document.addEventListener("focusin", remember, true);
    document.addEventListener("pointerdown", remember, true);
    document.addEventListener("visibilitychange", tick);
    const interval = window.setInterval(tick, 250);
    return () => {
      window.clearInterval(interval);
      events.forEach((event) => window.removeEventListener(event, activity, true));
      document.removeEventListener("focusin", remember, true);
      document.removeEventListener("pointerdown", remember, true);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [enabled, minutes]);
  if (!enabled || seconds === null) return null;
  return <div role="status" className="fixed bottom-24 left-1/2 z-[75] w-[min(92vw,32rem)] -translate-x-1/2 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 shadow-xl">
    <p className="font-black">あと{seconds}秒で駐車場へ戻ります</p>
    <p className="mt-1 text-xs">共用端末で操作がないため、利用者選択を解除します。</p>
    <button type="button" onClick={reportActivity} className="mt-3 min-h-11 rounded-xl bg-slate-900 px-4 font-bold text-white">操作を続ける</button>
  </div>;
}
