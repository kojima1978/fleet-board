"use client";

import { useEffect, useRef, useState } from "react";

const DEFAULT_IDLE_MS = 10 * 60_000;
const DEFAULT_WARNING_MS = 30_000;

export function useKioskIdle({ enabled, onReset, idleMs = DEFAULT_IDLE_MS, warningMs = DEFAULT_WARNING_MS }: { enabled: boolean; onReset: () => void; idleMs?: number; warningMs?: number }) {
  const [warningSeconds, setWarningSeconds] = useState<number | null>(null);
  const resetRef = useRef(onReset);
  resetRef.current = onReset;

  useEffect(() => {
    if (!enabled) { setWarningSeconds(null); return; }
    let warningTimer = 0;
    let resetTimer = 0;
    let countdownTimer = 0;
    const clearTimers = () => {
      window.clearTimeout(warningTimer);
      window.clearTimeout(resetTimer);
      window.clearInterval(countdownTimer);
    };
    const resetSession = () => {
      clearTimers();
      setWarningSeconds(null);
      resetRef.current();
    };
    const schedule = () => {
      clearTimers();
      setWarningSeconds(null);
      warningTimer = window.setTimeout(() => {
        const warningStartedAt = Date.now();
        setWarningSeconds(Math.ceil(warningMs / 1000));
        countdownTimer = window.setInterval(() => setWarningSeconds(Math.max(0, Math.ceil((warningMs - (Date.now() - warningStartedAt)) / 1000))), 250);
      }, Math.max(0, idleMs - warningMs));
      resetTimer = window.setTimeout(resetSession, idleMs);
    };
    window.addEventListener("pointerdown", schedule, { passive: true });
    window.addEventListener("keydown", schedule);
    schedule();
    return () => {
      clearTimers();
      window.removeEventListener("pointerdown", schedule);
      window.removeEventListener("keydown", schedule);
    };
  }, [enabled, idleMs, warningMs]);

  return warningSeconds;
}
