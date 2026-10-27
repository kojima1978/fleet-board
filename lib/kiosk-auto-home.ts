// Use wall-clock time so returning from a background tab also respects inactivity.
export function createAutoHomeTimer({ idleMs, now, blocked, warn, goHome }: {
  idleMs: number; now: () => number; blocked: () => boolean;
  warn: (seconds: number | null) => void; goHome: () => void;
}) {
  let deadline = now() + idleMs;
  let finished = false;
  return {
    activity() { deadline = now() + idleMs; warn(null); },
    tick() {
      if (finished) return;
      if (blocked()) { deadline = now() + idleMs; warn(null); return; }
      const remaining = deadline - now();
      if (remaining <= 0) { finished = true; warn(null); goHome(); return; }
      warn(remaining <= 30_000 ? Math.ceil(remaining / 1000) : null);
    },
  };
}
