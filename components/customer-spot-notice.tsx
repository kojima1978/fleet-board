"use client";

import { AlertTriangle } from "lucide-react";
import type { ParkingSpot } from "@/lib/types";
import { freeRegularSpots, isCustomerSpot, matchesParkingVehicleClass, needsParkingSpotWarning, PARKING_VEHICLE_CLASS_LABELS } from "@/lib/parking-spots";
import { Button } from "./ui";

const SHOWN_CODES = 6;

// お客様用や車種の異なる区画に止める前に、空いている通常区画を案内する。
export function ParkingSpotNotice({ spot, spots, vehicle, onChooseOther }: { spot: ParkingSpot; spots: ParkingSpot[]; vehicle: { id: string; isKei?: boolean } | null; onChooseOther?: () => void }) {
  if (!needsParkingSpotWarning(spot, vehicle)) return null;
  const customer = isCustomerSpot(spot);
  const mismatch = vehicle?.isKei !== undefined && !matchesParkingVehicleClass(vehicle, spot.vehicleClass);
  const others = freeRegularSpots(spots, vehicle).filter((other) => other.id !== spot.id);
  const codes = others.slice(0, SHOWN_CODES).map((spot) => spot.code).join("・");
  const more = others.length - SHOWN_CODES;
  return <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950">
    <p className="flex items-center gap-1.5 text-sm font-black"><AlertTriangle className="size-4 shrink-0 text-amber-600" />{customer ? "お客様用の区画です" : `${PARKING_VEHICLE_CLASS_LABELS[spot.vehicleClass]}の区画です`}</p>
    {mismatch ? <p className="mt-1 text-xs font-bold text-amber-900">{customer ? `推奨車種は「${PARKING_VEHICLE_CLASS_LABELS[spot.vehicleClass]}」です。` : null}選んだ車両は{vehicle.isKei ? "軽自動車" : "普通車"}です。区画の広さを確認し、できるだけ車種に合う区画に止めてください。</p> : <p className="mt-1 text-xs font-bold text-amber-900">できるだけ通常の区画に止めてください。</p>}
    <p className="mt-1 text-xs text-amber-800">{others.length ? `空いている通常区画：${codes}${more > 0 ? ` ほか${more}区画` : ""}` : "いま空いている通常区画はありません。"}</p>
    {onChooseOther && others.length ? <Button className="mt-2 w-full bg-amber-600 hover:bg-amber-700" onClick={onChooseOther}>別の区画を選ぶ</Button> : null}
  </div>;
}
