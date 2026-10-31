"use client";

import { useEffect, useRef } from "react";
import { isNfcSoundEnabled } from "./device-mode";
import { beginParkingGuidance, endParkingGuidance } from "./guidance-audio-priority";
import type { ParkingGuidanceEvent, ParkingGuidanceSetting } from "./parking-guidance";

let settingsPromise: Promise<ParkingGuidanceSetting[]> | null = null;
let lastAnnouncement = { key: "", at: 0 };

export function preloadParkingGuidance() {
  settingsPromise ??= fetch("/api/settings/parking-guidance", { cache: "no-store" }).then(async (response) => {
    if (!response.ok) throw new Error("駐車音声案内を読み込めませんでした");
    return (await response.json()).settings as ParkingGuidanceSetting[];
  }).catch((error) => { settingsPromise = null; throw error; });
  return settingsPromise;
}

export function refreshParkingGuidance() { settingsPromise = null; }

async function play(event: ParkingGuidanceEvent) {
  if (!isNfcSoundEnabled()) return;
  const now = Date.now();
  if (lastAnnouncement.key === event && now - lastAnnouncement.at < 1500) return;
  lastAnnouncement = { key: event, at: now };
  try {
    const setting = (await preloadParkingGuidance()).find((item) => item.event === event);
    if (!setting?.enabled) return;
    if (setting.audioUrl) {
      const audio = new Audio(setting.audioUrl);
      if (!beginParkingGuidance(audio)) return;
      audio.addEventListener("ended", () => endParkingGuidance(audio), { once: true });
      try { await audio.play(); }
      catch (error) { endParkingGuidance(audio); throw error; }
      return;
    }
    if ("speechSynthesis" in window && beginParkingGuidance(null)) {
      const utterance = new SpeechSynthesisUtterance(setting.message);
      utterance.lang = "ja-JP";
      utterance.rate = 0.95;
      window.speechSynthesis.speak(utterance);
    }
  } catch {
    // 音声案内は補助機能なので、再生や読込に失敗しても駐車操作は止めない。
  }
}

export function useParkingGuidanceAnnouncement(event: ParkingGuidanceEvent | null) {
  const previous = useRef<ParkingGuidanceEvent | null>(null);
  useEffect(() => {
    void preloadParkingGuidance().catch(() => {});
  }, []);
  useEffect(() => {
    if (!event) {
      previous.current = null;
      return;
    }
    if (previous.current === event) return;
    previous.current = event;
    void play(event);
  }, [event]);
}
