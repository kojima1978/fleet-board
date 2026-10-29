"use client";

import { AlertTriangle } from "lucide-react";
import type { ParkingSpot } from "@/lib/types";
import { freeRegularSpots } from "@/lib/parking-spots";
import { Button } from "./ui";

const SHOWN_CODES = 6;

// お客様用の区画に社用車を止めるときの注意。止めることはできるが、空いている通常区画へ誘導する。
export function CustomerSpotNotice({ spots, vehicle, onChooseOther }: { spots: ParkingSpot[]; vehicle: { id: string } | null; onChooseOther?: () => void }) {
  const others = freeRegularSpots(spots, vehicle);
  const codes = others.slice(0, SHOWN_CODES).map((spot) => spot.code).join("・");
  const more = others.length - SHOWN_CODES;
  return <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950">
    <p className="flex items-center gap-1.5 text-sm font-black"><AlertTriangle className="size-4 shrink-0 text-amber-600" />お客様用の区画です</p>
    <p className="mt-1 text-xs font-bold text-amber-900">できるだけ通常の区画に止めてください。</p>
    <p className="mt-1 text-xs text-amber-800">{others.length ? `空いている通常区画：${codes}${more > 0 ? ` ほか${more}区画` : ""}` : "いま空いている通常区画はありません。"}</p>
    {onChooseOther && others.length ? <Button className="mt-2 w-full bg-amber-600 hover:bg-amber-700" onClick={onChooseOther}>別の区画を選ぶ</Button> : null}
  </div>;
}
