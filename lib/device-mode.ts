"use client";

import { useSyncExternalStore } from "react";
import type { NfcBridgeStatus } from "./use-nfc-bridge";

// この端末だけの設定。PCごとに選ぶのでブラウザーに保存し、保存できない環境では初期値で動かす。
function createDeviceSetting<T>(key: string, parse: (value: string | null) => T, serialize: (value: T) => string | null, fallback: T) {
  const listeners = new Set<() => void>();
  const read = () => {
    try {
      return parse(window.localStorage.getItem(key));
    } catch {
      return fallback;
    }
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    // 別のタブで切り替えたときも揃える。
    const onStorage = (event: StorageEvent) => { if (event.key === key) listener(); };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  };
  return {
    read,
    useValue: () => useSyncExternalStore(subscribe, read, () => fallback),
    set: (value: T) => {
      try {
        const stored = serialize(value);
        if (stored === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, stored);
      } catch {
        // 保存できない環境では初期値のまま使う。
      }
      listeners.forEach((listener) => listener());
    },
  };
}

// この端末を入口の共用端末として使うか、各自のPCとして使うか。
// 「自動」はNFC Bridgeが動いていれば共用端末とみなす。
export type DeviceMode = "auto" | "kiosk" | "personal";

const deviceMode = createDeviceSetting<DeviceMode>(
  "fleetflow.deviceMode",
  (value) => value === "kiosk" || value === "personal" ? value : "auto",
  (value) => value === "auto" ? null : value,
  "auto",
);
export const useDeviceMode = deviceMode.useValue;
export const setDeviceMode = deviceMode.set;

export function isKioskDevice(mode: DeviceMode, nfcStatus: NfcBridgeStatus) {
  if (mode !== "auto") return mode === "kiosk";
  return nfcStatus === "ready" || nfcStatus === "no-reader";
}

// 共用端末で、操作がないと利用者を自動で解除するまでの分数。
export const USER_TIMEOUT_CHOICES = [1, 3, 5] as const;
export type UserTimeoutMinutes = (typeof USER_TIMEOUT_CHOICES)[number];

const userTimeout = createDeviceSetting<UserTimeoutMinutes>(
  "fleetflow.userTimeoutMinutes",
  (value) => USER_TIMEOUT_CHOICES.find((minutes) => String(minutes) === value) ?? 3,
  (value) => value === 3 ? null : String(value),
  3,
);
export const useUserTimeoutMinutes = userTimeout.useValue;
export const setUserTimeoutMinutes = userTimeout.set;

// NFCを読み取ったときの効果音。静かな場所に置く端末では切れるようにする。
const nfcSound = createDeviceSetting<boolean>(
  "fleetflow.nfcSound",
  (value) => value !== "off",
  (value) => value ? null : "off",
  true,
);
export const useNfcSoundEnabled = nfcSound.useValue;
export const setNfcSoundEnabled = nfcSound.set;
export const isNfcSoundEnabled = nfcSound.read;

// 長く操作がないとき、配置図の道路に車を走らせるか。
const idleTraffic = createDeviceSetting<boolean>(
  "fleetflow.idleTraffic",
  (value) => value !== "off",
  (value) => value ? null : "off",
  true,
);
export const useIdleTrafficEnabled = idleTraffic.useValue;
export const setIdleTrafficEnabled = idleTraffic.set;
