"use client";

import { useEffect, useRef, useState } from "react";
import { normalizeNfcUid } from "./nfc";

export type NfcBridgeStatus = "idle" | "connecting" | "ready" | "no-reader" | "offline";
export type QrBridgeStatus = "not-configured" | "ready" | "offline";
export type ScannerEvent = { sequence: number; kind: "nfc" | "qr"; value: string; reader: string; readAt: string };
type BridgeHealth = { sequence: number; readerConnected: boolean; qrReaderConnected?: boolean; qrConfigured?: boolean };
type BridgeEvents = { sequence: number; readerConnected: boolean; qrReaderConnected?: boolean; qrConfigured?: boolean; event: ScannerEvent | null };

export const NFC_BRIDGE_URL = process.env.NEXT_PUBLIC_NFC_BRIDGE_URL ?? "http://127.0.0.1:17831";
const NFC_BRIDGE_LAUNCH_URL = "fleetflow-nfc://start";

// 接続中のBridgeには機器接続の作り直しを依頼する。Bridge自体が停止している場合は、
// インストーラーがWindowsへ登録したURLから起動する。
export async function reconnectScannerBridge() {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`${NFC_BRIDGE_URL}/reconnect`, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error("bridge unavailable");
    return "restarting" as const;
  } catch {
    window.location.assign(NFC_BRIDGE_LAUNCH_URL);
    return "starting" as const;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function useScannerBridge(enabled: boolean, onScan: (event: ScannerEvent) => void, readiness: "any" | "nfc" = "any") {
  const [status, setStatus] = useState<NfcBridgeStatus>("idle");
  const callbackRef = useRef(onScan);
  callbackRef.current = onScan;

  useEffect(() => {
    if (!enabled) { setStatus("idle"); return; }
    let cancelled = false;
    let timer = 0;
    let sequence = 0;

    const request = async <T,>(path: string): Promise<T> => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 1500);
      try {
        const response = await fetch(`${NFC_BRIDGE_URL}${path}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("bridge unavailable");
        return await response.json() as T;
      } finally { window.clearTimeout(timeout); }
    };

    const poll = async () => {
      try {
        const result = await request<BridgeEvents>(`/events?after=${sequence}`);
        if (cancelled) return;
        sequence = result.sequence;
        setStatus(result.readerConnected || (readiness === "any" && result.qrReaderConnected) ? "ready" : "no-reader");
        if (result.event) callbackRef.current(result.event.kind === "nfc" ? { ...result.event, value: normalizeNfcUid(result.event.value) } : result.event);
        timer = window.setTimeout(poll, 350);
      } catch {
        if (!cancelled) { setStatus("offline"); timer = window.setTimeout(connect, 2000); }
      }
    };

    const connect = async () => {
      setStatus("connecting");
      try {
        const health = await request<BridgeHealth>("/health");
        if (cancelled) return;
        sequence = health.sequence;
        setStatus(health.readerConnected || (readiness === "any" && health.qrReaderConnected) ? "ready" : "no-reader");
        timer = window.setTimeout(poll, 250);
      } catch {
        if (!cancelled) { setStatus("offline"); timer = window.setTimeout(connect, 2000); }
      }
    };

    connect();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [enabled, readiness]);

  return status;
}

export function useNfcBridge(enabled: boolean, onUid: (uid: string) => void) {
  return useScannerBridge(enabled, (event) => { if (event.kind === "nfc") onUid(event.value); }, "nfc");
}

export function useQrBridgeHealth(enabled = true) {
  const [status, setStatus] = useState<QrBridgeStatus>("not-configured");
  useEffect(() => {
    if (!enabled) { setStatus("not-configured"); return; }
    let cancelled = false;
    let timer = 0;
    const check = async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 1500);
      try {
        const response = await fetch(`${NFC_BRIDGE_URL}/health`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("bridge unavailable");
        const health = await response.json() as BridgeHealth;
        if (!cancelled) setStatus(!health.qrConfigured ? "not-configured" : health.qrReaderConnected ? "ready" : "offline");
      } catch { if (!cancelled) setStatus("offline"); }
      finally { window.clearTimeout(timeout); if (!cancelled) timer = window.setTimeout(check, 2000); }
    };
    check();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [enabled]);
  return status;
}

export function useNfcBridgeHealth(enabled = true) {
  const [status, setStatus] = useState<NfcBridgeStatus>(enabled ? "connecting" : "idle");

  useEffect(() => {
    if (!enabled) { setStatus("idle"); return; }
    let cancelled = false;
    let timer = 0;

    const check = async () => {
      let nextCheckMs = 5000;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 1500);
      try {
        const response = await fetch(`${NFC_BRIDGE_URL}/health`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("bridge unavailable");
        const health = await response.json() as BridgeHealth;
        nextCheckMs = health.readerConnected ? 5000 : 1000;
        if (!cancelled) setStatus(health.readerConnected ? "ready" : "no-reader");
      } catch {
        nextCheckMs = 2000;
        if (!cancelled) setStatus("offline");
      } finally {
        window.clearTimeout(timeout);
        if (!cancelled) timer = window.setTimeout(check, nextCheckMs);
      }
    };

    setStatus("connecting");
    check();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [enabled]);

  return status;
}

export function nfcBridgeStatusText(status: NfcBridgeStatus) {
  if (status === "ready") return "NFCリーダー接続済み";
  if (status === "no-reader") return "連携ソフトは起動中です。リーダーを接続してください";
  if (status === "offline") return "NFC連携ソフトに接続できません（手動選択も可能です）";
  if (status === "connecting") return "NFC連携ソフトへ接続中…";
  return "";
}

export function scannerBridgeStatusText(status: NfcBridgeStatus) {
  if (status === "ready") return "読取機器に接続済みです";
  if (status === "no-reader") return "連携ソフトは起動中です。NFCリーダーまたはQRスキャナを接続してください";
  if (status === "offline") return "連携ソフトに接続できません（手動選択も可能です）";
  if (status === "connecting") return "連携ソフトへ接続中…";
  return "";
}
