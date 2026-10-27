import assert from "node:assert/strict";
import { createAutoHomeTimer } from "../lib/kiosk-auto-home";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

for (const minutes of [1, 3, 5]) {
  let now = 0;
  let blocked = false;
  let warning: number | null = null;
  let returns = 0;
  const idleMs = minutes * 60_000;
  const timer = createAutoHomeTimer({ idleMs, now: () => now, blocked: () => blocked,
    warn: (value) => { warning = value; }, goHome: () => { returns++; },
  });
  now = idleMs - 30_001; timer.tick(); assert.equal(warning, null);
  now++; timer.tick(); assert.equal(warning, 30);
  now += 1_001; timer.tick(); assert.equal(warning, 29);
  timer.activity(); assert.equal(warning, null);
  now += idleMs - 1; timer.tick(); assert.equal(returns, 0);
  // Dialog/draft/save protection wins even at the deadline.
  blocked = true; now++; timer.tick(); assert.equal(returns, 0); assert.equal(warning, null);
  now += idleMs * 2; timer.tick(); assert.equal(returns, 0);
  blocked = false;
  now += idleMs - 1; timer.tick(); assert.equal(returns, 0);
  now++; timer.tick(); assert.equal(returns, 1);
  timer.tick(); assert.equal(returns, 1);
}
// Background tabs may skip ticks; expiration still uses elapsed time.
let returns = 0;
let now = 0;
const timer = createAutoHomeTimer({ idleMs: 180_000, now: () => now, blocked: () => false,
  warn: () => {}, goHome: () => { returns++; },
});
now = 900_000; timer.tick(); assert.equal(returns, 1);
console.log("kiosk auto-home: warning, activity, protection, timeout choices, background resume passed");

// Exercise the real component effect: personal mode does not register anything;
// kiosk mode cleans up listeners/timers and checks protection before navigating.
const source = ts.transpileModule(readFileSync("components/kiosk-auto-home.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const listeners = new Map<string, Set<(event?: unknown) => void>>();
const intervals = new Set<() => void>();
let cleanup: (() => void) | undefined;
let cleared = 0;
let navigated = 0;
let modal = false;
let clock = 0;
const exports: { KioskAutoHome?: (props: { enabled: boolean; blocked?: boolean }) => unknown } = {};
const eventTarget = {
  addEventListener(name: string, fn: () => void) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(fn); },
  removeEventListener(name: string, fn: () => void) { listeners.get(name)?.delete(fn); },
};
class Input {
  type = "text"; value = ""; checked = false; disabled = false; isConnected = true;
  closest() { return {}; }
  matches() { return false; }
}
const mockDocument = { ...eventTarget, activeElement: null as Input | null, querySelector: () => modal ? {} : null };
runInNewContext(source, {
  exports, HTMLInputElement: Input, HTMLSelectElement: Input, HTMLTextAreaElement: Input,
  Date: { now: () => clock },
  document: mockDocument,
  window: { ...eventTarget, setInterval: (fn: () => void) => { intervals.add(fn); return fn; }, clearInterval: (fn: () => void) => intervals.delete(fn),
    location: { assign: (url: string) => { assert.equal(url, "/?idle=1"); navigated++; } },
  },
  require(id: string) {
    if (id === "react") return { useState: () => [null, () => {}], useRef: (value: unknown) => ({ current: value }), useEffect: (fn: () => (() => void) | undefined) => { cleanup = fn(); } };
    if (id === "react/jsx-runtime") return { jsx: () => null, jsxs: () => null };
    if (id.endsWith("device-mode")) return { useUserTimeoutMinutes: () => 3 };
    if (id.endsWith("employee-session")) return { clearSavedEmployee: () => { cleared++; } };
    if (id.endsWith("kiosk-auto-home")) return { createAutoHomeTimer };
    if (id === "./idle-traffic") return { ACTIVITY_EVENT: "fleetflow:activity", reportActivity: () => {} };
    throw new Error(`Unexpected import: ${id}`);
  },
});
exports.KioskAutoHome!({ enabled: false }); assert.equal(intervals.size, 0); assert.equal(listeners.size, 0);
exports.KioskAutoHome!({ enabled: true }); assert.equal(intervals.size, 1);
const tick = () => intervals.forEach((fn) => fn());
clock = 179_000; listeners.get("fleetflow:activity")!.forEach((fn) => fn());
clock = 180_000; tick(); assert.equal(navigated, 0);
modal = true; clock = 400_000; tick(); assert.equal(navigated, 0);
modal = false; clock = 580_000; tick(); assert.equal(navigated, 1); assert.equal(cleared, 1);
cleanup!(); assert.equal(intervals.size, 0); assert.ok([...listeners.values()].every((set) => set.size === 0));
exports.KioskAutoHome!({ enabled: true, blocked: true });
clock += 500_000; tick(); assert.equal(navigated, 1); cleanup!();
exports.KioskAutoHome!({ enabled: true });
const input = new Input();
mockDocument.activeElement = input;
listeners.get("focusin")!.forEach((fn) => fn({ target: input }));
input.value = "未保存"; mockDocument.activeElement = null;
clock += 500_000; tick(); assert.equal(navigated, 1, "dirty form stays protected after blur");
input.value = ""; clock += 180_000; tick(); assert.equal(navigated, 2, "reverting draft allows return");
cleanup!();
console.log("kiosk auto-home component: personal mode, scanner activity, modal/save protection and cleanup passed");
