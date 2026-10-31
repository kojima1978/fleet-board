"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Fuel, MapPin } from "lucide-react";
import { cn } from "./ui";

type GuidanceTab = "parking" | "fuel";

function SectionLoading() {
  return <div role="status" className="w-full max-w-[900px] rounded-xl border border-slate-200 bg-white p-8 text-center text-sm font-bold text-slate-500">設定を読み込んでいます…</div>;
}

const ParkingGuidanceSettings = dynamic(
  () => import("./parking-guidance-settings").then((module) => module.ParkingGuidanceSettings),
  { loading: SectionLoading },
);
const FuelReturnNoticeSettings = dynamic(
  () => import("./fuel-return-notice-settings").then((module) => module.FuelReturnNoticeSettings),
  { loading: SectionLoading },
);

export function GuidanceSettings() {
  const [tab, setTab] = useState<GuidanceTab>("parking");
  const tabClass = (active: boolean) => cn(
    "flex min-h-12 items-center justify-center gap-2 rounded-lg px-4 text-sm font-black transition",
    active ? "bg-slate-900 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800",
  );

  return <div className="space-y-4">
    <div role="tablist" aria-label="案内設定の種類" className="grid w-full max-w-[900px] grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
      <button type="button" role="tab" id="guidance-tab-parking" aria-selected={tab === "parking"} aria-controls="guidance-panel-parking" onClick={() => setTab("parking")} className={tabClass(tab === "parking")}>
        <MapPin className="size-4" />駐車案内
      </button>
      <button type="button" role="tab" id="guidance-tab-fuel" aria-selected={tab === "fuel"} aria-controls="guidance-panel-fuel" onClick={() => setTab("fuel")} className={tabClass(tab === "fuel")}>
        <Fuel className="size-4" />ガソリン案内
      </button>
    </div>
    <div role="tabpanel" id={`guidance-panel-${tab}`} aria-labelledby={`guidance-tab-${tab}`}>
      {tab === "parking" ? <ParkingGuidanceSettings /> : <FuelReturnNoticeSettings />}
    </div>
    <p className="w-full max-w-[900px] text-right text-[11px] text-slate-400">
      初期サンプル音声：<a className="font-bold underline decoration-slate-300 underline-offset-2 hover:text-slate-600" href="https://voicevox.hiroshiba.jp/" target="_blank" rel="noreferrer">VOICEVOX:ずんだもん</a>
    </p>
  </div>;
}
