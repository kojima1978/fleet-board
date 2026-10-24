"use client";

import { useEffect, useRef, useState } from "react";

const DEFAULT_IDLE_MS = 10 * 60_000;
const DEFAULT_WARNING_MS = 30_000;
export const KIOSK_USER_TIMEOUT_MS = 3 * 60_000;

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

// 共用端末で認証した利用者を、操作が途切れてから一定時間で自動解除する。残り秒数を返す。
// resetKey が変わる（社員証を読み直す）と最初から数え直す。
export function useKioskUserTimeout({ enabled, resetKey, onTimeout, timeoutMs = KIOSK_USER_TIMEOUT_MS }: { enabled: boolean; resetKey: string; onTimeout: () => void; timeoutMs?: number }) {
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const timeoutRef = useRef(onTimeout);
  timeoutRef.current = onTimeout;

  useEffect(() => {
    if (!enabled) { setRemainingSeconds(null); return; }
    let deadline = Date.now() + timeoutMs;
    const tick = () => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemainingSeconds(left);
      if (left === 0) { window.clearInterval(timer); timeoutRef.current(); }
    };
    const extend = () => { deadline = Date.now() + timeoutMs; tick(); };
    const timer = window.setInterval(tick, 1000);
    window.addEventListener("pointerdown", extend, { passive: true });
    window.addEventListener("keydown", extend);
    tick();
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pointerdown", extend);
      window.removeEventListener("keydown", extend);
    };
  }, [enabled, resetKey, timeoutMs]);

  return remainingSeconds;
}
