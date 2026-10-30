"use client";

import { AlertTriangle } from "lucide-react";
import type { ParkingSpot } from "@/lib/types";
import { blockingFrontSpots } from "@/lib/parking-spots";

// 手前の区画に車があるときの注意。中央の道路から出し入れできないことを知らせるだけで、登録は止めない。
export function FrontSpotNotice({ spot, spots, vehicleId, direction }: { spot: Pick<ParkingSpot, "frontSpotIds"> | null | undefined; spots: ParkingSpot[]; vehicleId?: string | null; direction: "out" | "in" }) {
  const blockers = blockingFrontSpots(spot, spots, vehicleId);
  if (!blockers.length) return null;
  const list = blockers.map((item) => `${item.code}（${item.vehicle?.name ?? "車両"}）`).join("・");
  return <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950">
    <p className="flex items-start gap-1.5 text-sm font-black"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />手前の区画{list}に車があります</p>
    <p className="mt-1 text-xs font-bold text-amber-900">{direction === "out" ? "出庫" : "入庫"}するには、先に手前の車の移動が必要です。登録はこのまま続けられます。</p>
  </div>;
}
