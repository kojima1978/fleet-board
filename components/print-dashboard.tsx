"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Printer } from "lucide-react";
import type { DashboardData } from "@/lib/types";
import { CUSTOMER_SPOT_CODES, HOLDING_SPOT_CODES, SAKURA_SPOT_CODE, TEMPORARY_SPOT_CODES } from "@/lib/parking-spots";

const START_HOUR = 6;
const END_HOUR = 22;

function tokyoDayStart() {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return new Date(`${day}T00:00:00+09:00`);
}

function formatPlateShort(value: string) {
  const parts = value.trim().split(/\s+/);
  return parts[parts.length - 1] || value;
}

export function PrintDashboard({ mode }: { mode: "parking" | "timeline" }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState(false);
  const printed = useRef(false);
  const dayStart = tokyoDayStart();

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/dashboard?from=${encodeURIComponent(dayStart.toISOString())}&days=1`, { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.json() as Promise<DashboardData>;
      })
      .then(setData)
      .catch((fetchError) => { if (fetchError?.name !== "AbortError") setError(true); });
    return () => controller.abort();
  }, [dayStart.toISOString()]);

  useEffect(() => {
    if (!data || printed.current || new URLSearchParams(window.location.search).get("print") !== "1") return;
    printed.current = true;
    const timer = window.setTimeout(() => window.print(), 500);
    return () => window.clearTimeout(timer);
  }, [data]);

  const title = mode === "parking" ? "駐車場 配置図（緊急時記入用）" : "車両タイムライン（緊急時記入用）";
  return <main className="print-shell min-h-screen bg-slate-100 p-4 text-slate-950 sm:p-6">
    <div className="no-print mx-auto mb-4 flex max-w-[1200px] items-center justify-between gap-3">
      <Link href="/settings/employees" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm"><ArrowLeft className="size-4" />設定へ戻る</Link>
      <button type="button" onClick={() => window.print()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-bold text-white shadow-sm hover:bg-blue-700"><Printer className="size-4" />A4横で印刷</button>
    </div>
    <article className="print-sheet mx-auto max-w-[1200px] overflow-hidden rounded-2xl bg-white p-5 shadow-sm">
      <header className="mb-3 flex items-end justify-between border-b-2 border-slate-900 pb-2">
        <div><p className="text-[10px] font-bold tracking-widest text-slate-500">FleetFlow 緊急時確認用</p><h1 className="text-xl font-black">{title}</h1></div>
        <p className="text-sm font-bold">日付：　　　　年　　　月　　　日（　　）</p>
      </header>
      {error ? <div className="flex items-center gap-2 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm font-bold text-rose-700"><AlertTriangle className="size-5" />データを取得できませんでした。画面を再読み込みしてください。</div> : !data ? <div className="grid min-h-96 place-items-center text-sm font-bold text-slate-500">印刷データを読み込み中…</div> : mode === "parking" ? <ParkingPrint data={data} /> : <TimelinePrint data={data} />}
    </article>
    <style jsx global>{`
      .print-sheet { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      @page { size: A4 landscape; margin: 8mm; }
      @media print {
        html, body { width: 100%; background: white !important; }
        .no-print { display: none !important; }
        .print-shell { min-height: 0 !important; padding: 0 !important; background: white !important; }
        .print-sheet { width: 100% !important; max-width: none !important; padding: 0 !important; border-radius: 0 !important; box-shadow: none !important; }
      }
    `}</style>
  </main>;
}

function ParkingPrint({ data }: { data: DashboardData }) {
  return <>
    <div className="mb-2 grid grid-cols-6 gap-x-3 gap-y-1 border border-slate-300 p-2 text-[7px] leading-tight"><b className="col-span-6 text-[8px]">登録車両一覧（配置図には車両名または車両番号を手書き）</b>{data.vehicles.map((vehicle) => <span key={vehicle.id} className="truncate"><strong>{vehicle.code}</strong> {vehicle.name}・{formatPlateShort(vehicle.plateNumber)}</span>)}</div>
    <div className="relative mx-auto aspect-[950/525] w-full overflow-hidden border border-slate-300 bg-white">
      <img src="/parking-layout.svg" alt="駐車場配置図" className="absolute inset-0 size-full" />
      {data.spots.map((spot) => <div key={spot.id} className={`absolute overflow-hidden text-slate-600 ${HOLDING_SPOT_CODES.has(spot.code) || TEMPORARY_SPOT_CODES.has(spot.code) ? "border-[3px] border-dashed border-slate-300 bg-slate-50/90" : "border-2 border-slate-400 bg-white/90"}`} style={{ left: `${spot.x}%`, top: `${spot.y}%`, width: `${spot.width}%`, height: `${spot.height}%` }}>
        <b className="absolute left-1 top-0.5 text-[7px] leading-none">{spot.code}{spot.code === SAKURA_SPOT_CODE ? " サクラ専用" : CUSTOMER_SPOT_CODES.has(spot.code) ? " お客様用" : HOLDING_SPOT_CODES.has(spot.code) ? " 仮置き（実在なし）" : TEMPORARY_SPOT_CODES.has(spot.code) ? " 一時" : ""}</b>
      </div>)}
    </div>
  </>;
}

function TimelinePrint({ data }: { data: DashboardData }) {
  const ticks = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, index) => START_HOUR + index);
  return <div className="border border-slate-300">
    <div className="flex border-b border-slate-300 bg-slate-100 text-[8px] font-bold"><div className="w-36 shrink-0 border-r border-slate-300 px-2 py-1">車両</div><div className="relative h-6 flex-1">{ticks.map((hour, index) => <span key={hour} className="absolute inset-y-0 border-l border-slate-300 pl-1 pt-1" style={{ left: `${index / (ticks.length - 1) * 100}%` }}>{hour === END_HOUR ? "" : `${hour}:00`}</span>)}</div></div>
    {data.vehicles.map((vehicle) => {
      return <div key={vehicle.id} className="flex h-8 border-b border-slate-200 last:border-b-0">
        <div className="w-36 shrink-0 border-r border-slate-300 px-2 py-0.5"><b className="block truncate text-[8px]">{vehicle.name}</b><span className="block truncate text-[6px] text-slate-600">{formatPlateShort(vehicle.plateNumber)} ・ {vehicle.code}</span></div>
        <div className="relative flex-1 bg-[repeating-linear-gradient(to_right,transparent_0,transparent_calc(6.25%-1px),#e2e8f0_calc(6.25%-1px),#e2e8f0_6.25%)]" />
      </div>;
    })}
  </div>;
}
