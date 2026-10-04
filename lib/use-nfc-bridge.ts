"use client";

import { useEffect, useRef, useState } from "react";
import { normalizeNfcUid } from "./nfc";

export type NfcBridgeStatus = "idle" | "connecting" | "ready" | "no-reader" | "offline";
type BridgeHealth = { sequence: number; readerConnected: boolean };
type BridgeEvent = { sequence: number; uid: string; reader: string; readAt: string };
type BridgeEvents = { sequence: number; readerConnected: boolean; event: BridgeEvent | null };

const BRIDGE_URL = process.env.NEXT_PUBLIC_NFC_BRIDGE_URL ?? "http://127.0.0.1:17831";

export function useNfcBridge(enabled: boolean, onUid: (uid: string) => void) {
  const [status, setStatus] = useState<NfcBridgeStatus>("idle");
  const callbackRef = useRef(onUid);
  callbackRef.current = onUid;

  useEffect(() => {
    if (!enabled) { setStatus("idle"); return; }
    let cancelled = false;
    let timer = 0;
    let sequence = 0;

    const request = async <T,>(path: string): Promise<T> => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 1500);
      try {
        const response = await fetch(`${BRIDGE_URL}${path}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("bridge unavailable");
        return await response.json() as T;
      } finally { window.clearTimeout(timeout); }
    };

    const poll = async () => {
      try {
        const result = await request<BridgeEvents>(`/events?after=${sequence}`);
        if (cancelled) return;
        sequence = result.sequence;
        setStatus(result.readerConnected ? "ready" : "no-reader");
        if (result.event) callbackRef.current(normalizeNfcUid(result.event.uid));
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
        setStatus(health.readerConnected ? "ready" : "no-reader");
        timer = window.setTimeout(poll, 250);
      } catch {
        if (!cancelled) { setStatus("offline"); timer = window.setTimeout(connect, 2000); }
      }
    };

    connect();
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
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 1500);
      try {
        const response = await fetch(`${BRIDGE_URL}/health`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("bridge unavailable");
        const health = await response.json() as BridgeHealth;
        if (!cancelled) setStatus(health.readerConnected ? "ready" : "no-reader");
      } catch {
        if (!cancelled) setStatus("offline");
      } finally {
        window.clearTimeout(timeout);
        if (!cancelled) timer = window.setTimeout(check, 5000);
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
  if (status === "offline") return "NFC連携ソフトを起動してください（手入力も可能です）";
  if (status === "connecting") return "NFC連携ソフトへ接続中…";
  return "";
}
