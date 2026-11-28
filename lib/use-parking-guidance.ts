"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { isNfcSoundEnabled, useNfcSoundEnabled } from "./device-mode";
import { beginParkingGuidance, createGuidanceUtterance, endParkingGuidance } from "./guidance-audio-priority";
import type { ParkingGuidanceEvent, ParkingGuidanceSetting } from "./parking-guidance";

let settingsPromise: Promise<ParkingGuidanceSetting[]> | null = null;
let lastAnnouncement = { key: "", at: 0 };

// 駐車案内はガソリン案内と同じく、駐車場の入口にある共用端末だけで鳴らす。席のPCで操作したときは鳴らさない。
export const ParkingGuidanceKioskContext = createContext(false);

export function preloadParkingGuidance() {
  settingsPromise ??= fetch("/api/settings/parking-guidance", { cache: "no-store" }).then(async (response) => {
    if (!response.ok) throw new Error("駐車音声案内を読み込めませんでした");
    return (await response.json()).settings as ParkingGuidanceSetting[];
  }).catch((error) => { settingsPromise = null; throw error; });
  return settingsPromise;
}

export function refreshParkingGuidance() { settingsPromise = null; }

async function play(event: ParkingGuidanceEvent, repeat = false) {
  if (!isNfcSoundEnabled()) return;
  const now = Date.now();
  if (!repeat && lastAnnouncement.key === event && now - lastAnnouncement.at < 1500) return;
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
    if ("speechSynthesis" in window && beginParkingGuidance(null)) window.speechSynthesis.speak(createGuidanceUtterance(setting.message));
  } catch {
    // 音声案内は補助機能なので、再生や読込に失敗しても駐車操作は止めない。
  }
}

export function useParkingGuidanceAnnouncement(event: ParkingGuidanceEvent | null) {
  const kiosk = useContext(ParkingGuidanceKioskContext);
  const previous = useRef<ParkingGuidanceEvent | null>(null);
  useEffect(() => {
    if (kiosk) void preloadParkingGuidance().catch(() => {});
  }, [kiosk]);
  useEffect(() => {
    if (!event) {
      previous.current = null;
      return;
    }
    if (previous.current === event) return;
    previous.current = event;
    // 共用端末かどうかが途中で変わっても、同じ場面は案内し直さない。
    if (kiosk) void play(event);
  }, [event, kiosk]);
}

// 聞き逃したときに案内をもう一度流す。案内がオフの場面や、音を出さない端末では何も返さない。
export function useParkingGuidanceReplay(event: ParkingGuidanceEvent) {
  const kiosk = useContext(ParkingGuidanceKioskContext);
  const soundEnabled = useNfcSoundEnabled();
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (!kiosk || !soundEnabled) return;
    let active = true;
    preloadParkingGuidance().then((settings) => { if (active) setEnabled(!!settings.find((item) => item.event === event)?.enabled); }).catch(() => {});
    return () => { active = false; };
  }, [event, kiosk, soundEnabled]);
  return kiosk && soundEnabled && enabled ? () => void play(event, true) : null;
}
