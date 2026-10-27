"use client";

import { CalendarClock, ChevronRight, Play } from "lucide-react";
import type { Trip, Vehicle } from "@/lib/types";
import type { ParkingReservation } from "@/lib/parking-reservations";

const time = (value: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));

export function ParkingReservationBadge({ reservation }: { reservation: ParkingReservation }) {
  return <span aria-label={`${reservation.waiting ? "開始待ち" : "予約"} ${time(reservation.trip.plannedStart)} ${reservation.trip.employee.name}`} className="pointer-events-none absolute -top-2 right-0 z-[2] whitespace-nowrap rounded bg-violet-700 px-1 py-0.5 text-[7px] font-black leading-tight text-white shadow-sm @2xl:text-[9px]">{reservation.waiting ? "開始待ち" : "予約"} {time(reservation.trip.plannedStart)}</span>;
}

export function ParkingReservations({ reservations, onStart, onEdit }: { reservations: ParkingReservation[]; onStart: (vehicle: Vehicle) => void; onEdit: (trip: Trip) => void }) {
  return <section aria-label="まもなく利用予定（30分以内）">
    <div className="flex items-center justify-between border-y border-violet-100 bg-violet-50 px-3 py-2"><h3 className="flex items-center gap-1 text-xs font-black text-violet-900"><CalendarClock className="size-3.5" />まもなく利用予定<span className="text-[9px] font-bold">（30分以内）</span></h3><span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-black text-violet-800">{reservations.length}件</span></div>
    {reservations.length === 0 ? <p className="px-3 py-4 text-center text-[11px] text-slate-400">30分以内に開始する予約はありません</p> : <ul className="divide-y divide-violet-100">{reservations.map(({ trip, vehicle, spotCode, waiting, inUse }) => {
      const canStart = waiting && !inUse && vehicle.status === "AVAILABLE";
      return <li key={trip.id} className="px-3 py-2">
        <button type="button" aria-label={`${vehicle.name}の予約内容を確認`} onClick={() => onEdit(trip)} className="flex min-h-11 w-full items-center gap-2 rounded-lg text-left hover:bg-violet-50">
          <CalendarClock className="size-4 shrink-0 text-violet-600" />
          <span className="min-w-0 flex-1"><span className="block truncate text-xs font-black">{vehicle.code}　{vehicle.name}</span><span className="block truncate text-[10px] text-slate-600">{trip.employee.name} ・ {time(trip.plannedStart)}〜{time(trip.plannedEnd)}</span><span className="block text-[10px] font-bold text-violet-700">{inUse ? "現在利用中・次の予約あり" : vehicle.status === "MAINTENANCE" ? "整備中" : spotCode ? `駐車区画 ${spotCode}` : "駐車位置未設定"}{waiting ? " ・ 開始待ち" : " ・ 開始予定"}</span></span>
          <ChevronRight className="size-3.5 shrink-0 text-violet-400" />
        </button>
        <button type="button" disabled={!canStart} title={canStart ? "利用者を確認して利用開始へ進みます" : inUse ? "現在の利用が終了するまで開始できません" : !waiting ? "予約の開始時刻になったら利用開始できます" : "車両の利用状態を確認してください"} onClick={() => onStart(vehicle)} className="mt-1 inline-flex min-h-9 w-full items-center justify-center gap-1 rounded-lg bg-violet-600 px-2 text-[11px] font-black text-white hover:bg-violet-700 disabled:cursor-default disabled:bg-slate-100 disabled:text-slate-500"><Play className="size-3" />{canStart ? "利用者を確認して利用開始" : inUse ? "現在利用中" : !waiting ? `${time(trip.plannedStart)}から利用開始` : "現在利用できません"}</button>
      </li>;
    })}</ul>}
    <p className="border-t border-violet-100 px-3 py-2 text-[10px] text-slate-500">予約だけでは駐車位置は変わりません。利用開始後に「利用中」へ移ります。</p>
  </section>;
}
