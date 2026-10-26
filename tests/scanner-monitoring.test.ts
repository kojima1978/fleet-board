import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// 実際のhookを小さなeffect実行環境で検査する。USB機器・ブラウザー・DBは不要。
const source = ts.transpileModule(readFileSync("lib/use-nfc-bridge.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
type Mode = "auto" | "kiosk" | "personal";
type Effect = { deps: unknown[]; cleanup?: () => void };

async function checkHook(name: "useNfcBridgeHealth" | "useQrBridgeHealth", inactive: string) {
  let mode: Mode = "auto";
  let savedMode: Mode = "personal";
  let calls = 0;
  let cursor = 0;
  let nextTimer = 0;
  const states: unknown[] = [];
  const effects: Effect[] = [];
  const timers = new Map<number, () => void>();
  const exports: Record<string, (enabled?: boolean) => string> = {};
  runInNewContext(source, {
    exports,
    require: (id: string) => {
      if (id === "./device-mode") return { useDeviceMode: () => mode, readDeviceMode: () => savedMode };
      if (id === "./nfc") return { normalizeNfcUid: (value: string) => value };
      if (id !== "react") throw new Error(`Unexpected import: ${id}`);
      return {
        useState: (initial: unknown) => {
          const slot = cursor++;
          if (!(slot in states)) states[slot] = initial;
          return [states[slot], (value: unknown) => { states[slot] = value; }];
        },
        useEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
          const slot = cursor++;
          const previous = effects[slot];
          if (previous && deps.every((value, index) => Object.is(value, previous.deps[index]))) return;
          previous?.cleanup?.();
          effects[slot] = { deps, cleanup: effect() || undefined };
        },
      };
    },
    process: { env: {} },
    AbortController,
    window: {
      setTimeout: (callback: () => void) => { timers.set(++nextTimer, callback); return nextTimer; },
      clearTimeout: (timer: number) => timers.delete(timer),
    },
    fetch: async () => {
      calls++;
      return { ok: true, json: async () => ({ readerConnected: true, qrConfigured: true, qrReaderConnected: true }) };
    },
  });
  const render = (enabled = true) => { cursor = 0; return exports[name](enabled); };
  const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

  // SSR/hydrationのautoでも、保存済みpersonalなら初回通信を禁止する。
  render();
  await settle();
  assert.equal(calls, 0, `${name}: hydration must not contact a personal PC's bridge`);
  mode = "personal";
  assert.equal(render(), inactive);
  assert.equal(timers.size, 0);

  for (const activeMode of ["auto", "kiosk"] as const) {
    mode = savedMode = activeMode;
    const before: number = calls;
    render();
    await settle();
    assert.equal(calls, before + 1, `${name}: ${activeMode} must still monitor`);
    assert.equal(render(), "ready");
    assert.equal(timers.size, 1, "monitoring must schedule its next check");
    mode = savedMode = "personal";
    assert.equal(render(), inactive, "switching to personal must immediately hide the previous ready status");
    assert.equal(timers.size, 0, "switching to personal must cancel polling");
  }

  mode = savedMode = "kiosk";
  const before = calls;
  assert.equal(render(false), inactive);
  await settle();
  assert.equal(calls, before, "disabled hook must not fetch");
  assert.equal(timers.size, 0);
}

async function main() {
  await checkHook("useNfcBridgeHealth", "idle");
  await checkHook("useQrBridgeHealth", "not-configured");
  console.log("Scanner monitoring tests passed: personal/hydration makes no requests; auto/kiosk monitors; switching cancels polling");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
