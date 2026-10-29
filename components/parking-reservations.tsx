"use client";

import { CalendarClock, ChevronRight, Wrench } from "lucide-react";
import type { ParkingSpot, Trip, Vehicle, VehicleMaintenance } from "@/lib/types";
import type { ParkingReservation } from "@/lib/parking-reservations";
import { canSendOutMaintenance, formatMaintenanceBadge, formatMaintenanceStart, formatMaintenanceTime, UPCOMING_MAINTENANCE_LIMIT } from "@/lib/maintenance";
import { cn } from "./ui";

const time = (value: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));

export function ParkingReservationBadge({ reservation }: { reservation: ParkingReservation }) {
  return <span aria-label={`${reservation.waiting ? "開始待ち" : "予約"} ${time(reservation.trip.plannedStart)} ${reservation.trip.employee.name}`} className="pointer-events-none absolute -top-2 right-0 z-[2] whitespace-nowrap rounded border border-slate-300 bg-white px-1 py-0.5 text-[7px] font-black leading-tight text-slate-700 shadow-sm @2xl:text-[9px]">{reservation.waiting ? "開始待ち" : "予約"} {time(reservation.trip.plannedStart)}</span>;
}

// 利用開始は配置図で車両を選んで行う。ここでは予約内容の確認だけにする。
export function ParkingReservations({ reservations, onEdit }: { reservations: ParkingReservation[]; onEdit: (trip: Trip) => void }) {
  return <section aria-label="まもなく利用予定（30分以内）" className="mt-auto pt-8">
    <div className="flex items-center justify-between border-y border-slate-100 px-3 py-2"><h3 className="flex items-center gap-1.5 text-xs font-black text-slate-800"><CalendarClock className="size-3.5 text-slate-500" />まもなく利用予定</h3><span className="text-[10px] font-bold text-slate-400">30分以内 ・ {reservations.length}件</span></div>
    {reservations.length === 0 ? <p className="px-3 py-2.5 text-center text-[11px] text-slate-400">30分以内に開始する予約はありません</p> : <ul className="max-h-[168px] divide-y divide-slate-100 overflow-y-auto">{reservations.map(({ trip, vehicle, spotCode, waiting, inUse }) => {
      const place = inUse ? "現在利用中" : vehicle.status === "MAINTENANCE" ? "整備中" : spotCode ? `区画 ${spotCode}` : "位置未設定";
      const state = inUse ? "次の予約あり" : waiting ? "開始待ち" : "開始予定";
      return <li key={trip.id} className="flex min-h-[52px] items-center gap-1 px-2 py-1.5">
        <button type="button" aria-label={`${vehicle.name}の予約内容を確認`} onClick={() => onEdit(trip)} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-slate-50">
          <CalendarClock className="size-3.5 shrink-0 text-slate-500" />
          <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-xs font-black">{vehicle.code}　{vehicle.name}</span><time className="shrink-0 text-[10px] font-black tabular-nums text-slate-700">{time(trip.plannedStart)}</time></span><span className="mt-0.5 flex items-center gap-1 text-[10px]"><span className="min-w-0 flex-1 truncate text-slate-500">{trip.employee.name} ・ {place}</span><span className="shrink-0 font-bold text-slate-600">{state}</span></span></span>
          <ChevronRight className="size-3.5 shrink-0 text-slate-300" />
        </button>
      </li>;
    })}</ul>}
  </section>;
}

// 前日になった車検・整備の予定。予定がなければ欄ごと出さない。タップでその車両の車検・故障の画面を開く。
// 行の形は「まもなく利用予定」の予約と合わせる。今日の予定と開始予定を過ぎた予定は出庫待ちにする。出庫は配置図で車両を選んで行う。
export function UpcomingMaintenances({ items, vehicles, spots, now, onOpen }: { items: VehicleMaintenance[]; vehicles: Vehicle[]; spots: Pick<ParkingSpot, "id" | "code">[]; now: number; onOpen: (vehicle: Vehicle) => void }) {
  const rows = items.flatMap((maintenance) => { const vehicle = vehicles.find((candidate) => candidate.id === maintenance.vehicleId); return vehicle ? [{ maintenance, vehicle }] : []; });
  if (rows.length === 0) return null;
  const hidden = rows.length - UPCOMING_MAINTENANCE_LIMIT;
  return <section aria-label="車検・整備の予定（前日から）">
    <div className="flex items-center justify-between border-y border-slate-100 px-3 py-2"><h3 className="flex items-center gap-1.5 text-xs font-black text-slate-800"><Wrench className="size-3.5 text-amber-600" />車検・整備の予定</h3><span className="text-[10px] font-bold text-slate-400">前日から ・ {rows.length}件</span></div>
    <ul className="divide-y divide-slate-100">{rows.slice(0, UPCOMING_MAINTENANCE_LIMIT).map(({ maintenance, vehicle }) => {
      const offSite = maintenance.kind === "OFF_SITE";
      const due = canSendOutMaintenance(maintenance, now);
      const spotCode = spots.find((spot) => spot.id === vehicle.parkingSpotId)?.code;
      const place = vehicle.status === "IN_USE" ? "現在利用中" : vehicle.status === "MAINTENANCE" ? "整備中" : spotCode ? `区画 ${spotCode}` : "位置未設定";
      const state = offSite ? (due ? "出庫待ち" : "出庫予定") : (due ? "開始待ち" : "開始予定");
      return <li key={maintenance.id} className="flex min-h-[52px] items-center gap-1 px-2 py-1.5">
        <button type="button" aria-label={`${vehicle.name}の車検・整備の予定を確認`} onClick={() => onOpen(vehicle)} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-slate-50">
          <Wrench className="size-3.5 shrink-0 text-amber-600" />
          <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-xs font-black">{vehicle.code}　{vehicle.name}</span><time className="shrink-0 text-[10px] font-black tabular-nums text-slate-700">{formatMaintenanceStart(maintenance.plannedStart, now)}</time></span><span className="mt-0.5 flex items-center gap-1 text-[10px]"><span className="min-w-0 flex-1 truncate text-slate-500">{place} ・ 戻り {maintenance.plannedEnd ? formatMaintenanceTime(maintenance.plannedEnd) : "未定"}</span><span className={cn("shrink-0 font-bold text-slate-600", due && "text-amber-700")}>{state}</span></span></span>
          <ChevronRight className="size-3.5 shrink-0 text-slate-300" />
        </button>
      </li>;
    })}</ul>
    {hidden > 0 ? <p className="px-3 pb-2 text-[10px] font-bold text-slate-400">ほか{hidden}件は車両登録の「車検・故障」から確認できます</p> : null}
  </section>;
}

// 配置図の区画に付ける出庫待ちの札。予約の札と同じ位置・形で、車検は黄色にする。
export function MaintenanceSendOutBadge({ maintenance, now }: { maintenance: VehicleMaintenance; now: number }) {
  const label = maintenance.kind === "OFF_SITE" ? "車検" : "整備";
  const when = formatMaintenanceBadge(maintenance.plannedStart, now);
  return <span aria-label={`${label}の出庫待ち ${when}`} className="pointer-events-none absolute -top-2 right-0 z-[2] whitespace-nowrap rounded border border-amber-400 bg-amber-50 px-1 py-0.5 text-[7px] font-black leading-tight text-amber-800 shadow-sm @2xl:text-[9px]">{label} {when}</span>;
}
