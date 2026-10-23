"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import type { DashboardData, ParkingSpot, Vehicle } from "@/lib/types";
import { PARKING_SPOT_ROLES, SPOT_ROLE_DESCRIPTIONS, SPOT_ROLE_LABELS, type ParkingSpotRole } from "@/lib/parking-spots";
import { Card, cn } from "./ui";

type Mutate = (body: object, success: string) => Promise<boolean>;

const roleBadge: Record<ParkingSpotRole, string> = {
  REGULAR: "bg-slate-100 text-slate-600",
  TEMPORARY: "bg-sky-50 text-sky-700",
  CUSTOMER: "bg-amber-50 text-amber-700",
  DEDICATED: "bg-violet-50 text-violet-700",
  HOLDING: "bg-zinc-200 text-zinc-700",
};
const select = "min-h-9 min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-xs disabled:opacity-50";

// 区画ごとの役割（通常・一時・お客様用・専用・仮置き）を変更する管理画面。
export function SpotRoleSettings({ data, mutate }: { data: DashboardData; mutate: Mutate }) {
  const vehicles = data.vehicles.filter((vehicle) => vehicle.active);
  return <div className="space-y-3">
    <Card className="p-4">
      <h3 className="text-sm font-black">役割の種類</h3>
      <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2 xl:grid-cols-3">
        {PARKING_SPOT_ROLES.map((role) => <div key={role} className="flex items-start gap-2"><dt className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-black", roleBadge[role])}>{SPOT_ROLE_LABELS[role]}</dt><dd className="pt-0.5 text-slate-500">{SPOT_ROLE_DESCRIPTIONS[role]}</dd></div>)}
      </dl>
    </Card>
    <Card className="divide-y divide-slate-100 overflow-hidden">
      {data.spots.map((spot) => <SpotRoleRow key={spot.id} spot={spot} vehicles={vehicles} mutate={mutate} />)}
    </Card>
  </div>;
}

function SpotRoleRow({ spot, vehicles, mutate }: { spot: ParkingSpot; vehicles: Vehicle[]; mutate: Mutate }) {
  const [role, setRole] = useState<ParkingSpotRole>(spot.role);
  const [vehicleId, setVehicleId] = useState(spot.dedicatedVehicleId ?? "");
  const [saving, setSaving] = useState(false);
  useEffect(() => { setRole(spot.role); setVehicleId(spot.dedicatedVehicleId ?? ""); }, [spot.role, spot.dedicatedVehicleId]);
  const dedicatedVehicleId = role === "DEDICATED" ? vehicleId || null : null;
  const changed = role !== spot.role || dedicatedVehicleId !== (spot.role === "DEDICATED" ? spot.dedicatedVehicleId : null);
  // 専用にするとき、別の車がすでに停まっている区画は先に移動してもらう。
  const blockedByParked = role === "DEDICATED" && !!spot.vehicle && !!vehicleId && spot.vehicle.id !== vehicleId;
  const valid = role !== "DEDICATED" || (!!vehicleId && !blockedByParked);
  const save = async () => {
    if (!changed || !valid || saving) return;
    setSaving(true);
    try {
      await mutate({ action: "updateSpotRole", id: spot.id, version: spot.version, role, dedicatedVehicleId }, `区画 ${spot.code} の役割を変更しました`);
    } finally { setSaving(false); }
  };
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-900 text-sm font-black text-white">{spot.code}</span>
    <div className="min-w-0 flex-1 basis-40">
      <p className="text-xs font-bold"><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-black", roleBadge[spot.role])}>{SPOT_ROLE_LABELS[spot.role]}</span>{spot.role === "DEDICATED" ? <span className="ml-1.5 text-slate-600">{spot.dedicatedVehicleName ?? "車両未設定"}</span> : null}</p>
      <p className={cn("mt-0.5 truncate text-[11px]", blockedByParked ? "font-bold text-rose-600" : "text-slate-400")}>{blockedByParked ? `${spot.vehicle?.name}が駐車中です。先に移動してください` : spot.vehicle ? `駐車中：${spot.vehicle.name}` : spot.enabled ? "空き" : "使用停止中"}</p>
    </div>
    <select aria-label={`区画 ${spot.code}の役割`} disabled={saving} value={role} onChange={(event) => setRole(event.target.value as ParkingSpotRole)} className={select}>
      {PARKING_SPOT_ROLES.map((item) => <option key={item} value={item}>{SPOT_ROLE_LABELS[item]}</option>)}
    </select>
    {role === "DEDICATED" ? <select aria-label={`区画 ${spot.code}の専用車両`} disabled={saving} value={vehicleId} onChange={(event) => setVehicleId(event.target.value)} className={cn(select, "max-w-48")}>
      <option value="">車両を選択</option>
      {vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.code} {vehicle.name}</option>)}
    </select> : null}
    <button type="button" disabled={!changed || !valid || saving} onClick={() => void save()} className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40"><Check className="size-3.5" />保存</button>
  </div>;
}
