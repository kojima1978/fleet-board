import { Fuel } from "lucide-react";
import { FUEL_LEVEL_LABELS, formatFuelLevel, isLowFuel } from "@/lib/fuel-level";
import { cn } from "./ui";

const fuelFillHeight = (level: number) => `${Math.max(6, level * 25)}%`;

function FuelGauge({ level, className }: { level: number; className?: string }) {
  return <span aria-hidden className={cn("relative block overflow-hidden rounded-b-md rounded-t-sm border-2 border-slate-300 bg-white", className)}><span className={cn("absolute inset-x-0 bottom-0", isLowFuel(level) ? "bg-amber-300" : "bg-emerald-300")} style={{ height: fuelFillHeight(level) }} /></span>;
}

export function FuelLevelLabel({ level }: { level: number; compact?: boolean }) {
  return <span className="whitespace-nowrap">ガソリン残量 {formatFuelLevel(level)}</span>;
}

export function FuelReminder({ context, compact = false, attention = false }: { context: "start" | "return"; compact?: boolean; attention?: boolean }) {
  return <div role="note" className={cn("flex items-start gap-2 text-amber-950", compact ? "max-w-xl" : "rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2.5", attention && "fuel-reminder-attention")}><Fuel className="mt-0.5 size-4 shrink-0 text-amber-700" /><div><p className="text-xs font-black">{context === "start" ? "ガソリン残量が1/2以下です" : "ガソリン残量が1/2未満です"}</p><p className="mt-0.5 text-[11px] leading-relaxed text-amber-900">{context === "start" ? "可能であれば、利用中の給油をお願いします。" : "次回から、可能な範囲で給油してから返却をお願いします。"}</p></div></div>;
}

export function FuelLevelPicker({ value, onChange, emptyHint = "選ばずに返却すると、ガソリン残量は記録されません" }: { value: number | null; onChange: (level: number) => void; emptyHint?: string }) {
  return <fieldset><legend className="mb-1.5 text-xs font-bold text-slate-600">ガソリン残量（おおよそで構いません）</legend><div className="grid grid-cols-5 gap-2">{FUEL_LEVEL_LABELS.map((label, level) => ({ label, level })).reverse().map(({ label, level }) => <button key={label} type="button" aria-pressed={value === level} aria-label={`ガソリン残量 ${label}`} onClick={() => onChange(level)} className={cn("flex min-h-16 flex-col items-center justify-end gap-1 rounded-xl border p-1.5 text-sm font-black transition", value === level ? isLowFuel(level) ? "border-amber-500 bg-amber-50 text-amber-800 ring-2 ring-amber-200" : "border-blue-500 bg-white text-blue-700 ring-2 ring-blue-200" : "border-slate-200 text-slate-600 hover:bg-slate-50")}><FuelGauge level={level} className="h-7 w-5" /><span className="whitespace-nowrap">{label}</span></button>)}</div>{value === null ? <p className="mt-1.5 text-[11px] text-slate-500">{emptyHint}</p> : null}</fieldset>;
}
