"use client";

import { useEffect, useState } from "react";

// しばらく誰も操作していないとき、配置図の道路に車を走らせて画面に動きを出す（同じ表示のままの焼き付け対策も兼ねる）。
// 画面を触る、キーを押す、マウスを動かす、NFCをかざすと消え、そこから数え直す。
const IDLE_MS = 60 * 60_000;
// ときどき緊急車両にする。パトカーは10回に1回くらい、救急車と消防車はごくまれに出し、赤色灯を点滅させて少し速く走らせる。
const VEHICLES = {
  car: { rate: 0, driveMs: 8_000 },
  police: { rate: 0.1, driveMs: 6_000 },
  ambulance: { rate: 0.03, driveMs: 6_000 },
  fire: { rate: 0.02, driveMs: 7_000 },
} as const;
type Kind = keyof typeof VEHICLES;
// NFCの読み取りは画面の操作として拾えないので、読み取ったときにこのイベントを送ってもらう。
export const ACTIVITY_EVENT = "fleetflow:activity";

export function reportActivity() {
  window.dispatchEvent(new Event(ACTIVITY_EVENT));
}

type Car = { id: number; down: boolean; color: string; kind: Kind };

function pickKind(): Kind {
  let roll = Math.random();
  for (const kind of ["police", "ambulance", "fire"] as const) {
    if (roll < VEHICLES[kind].rate) return kind;
    roll -= VEHICLES[kind].rate;
  }
  return "car";
}

export function IdleTraffic({ enabled, colors }: { enabled: boolean; colors: string[] }) {
  const [idle, setIdle] = useState(false);
  const [car, setCar] = useState<Car | null>(null);

  useEffect(() => {
    if (!enabled) { setIdle(false); return; }
    let timer = 0;
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), IDLE_MS);
    };
    // 置いてあるだけのマウスの細かい揺れでは起きないよう、マウスの移動はある程度動いたときだけ数える。
    let lastX = 0;
    let lastY = 0;
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || Math.abs(event.clientX - lastX) + Math.abs(event.clientY - lastY) < 8) return;
      lastX = event.clientX;
      lastY = event.clientY;
      wake();
    };
    window.addEventListener("pointerdown", wake, { passive: true });
    window.addEventListener("keydown", wake);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener(ACTIVITY_EVENT, wake);
    wake();
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener(ACTIVITY_EVENT, wake);
    };
  }, [enabled]);

  useEffect(() => {
    if (!idle) { setCar(null); return; }
    let id = 0;
    let timer = 0;
    const next = (delay: number) => {
      timer = window.setTimeout(() => {
        id += 1;
        // 下りは4割ほど。上りと下りで車線を分ける。
        setCar({ id, down: Math.random() < 0.4, color: colors[Math.floor(Math.random() * colors.length)] ?? "#2563eb", kind: pickKind() });
        // 走るのは1回だけ。そのまま操作がなければ、また1時間後に走らせる。
        next(IDLE_MS);
      }, delay);
    };
    next(1_500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 色はポーリングのたびに作り直されるので、走り出すときの色で十分。
  }, [idle]);

  if (!car) return null;
  // 道路は背景画像の横19%〜27%。左側通行なので、上りは左の車線、下りは右の車線を走る。
  return <div aria-hidden className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
    <div key={car.id} className={`idle-car ${car.down ? "idle-car-down" : "idle-car-up"} ${car.kind === "fire" ? "idle-car-long" : ""}`} style={{ left: car.down ? "23.6%" : "19.8%", animationDuration: `${VEHICLES[car.kind].driveMs}ms` }} onAnimationEnd={(event) => { if (event.target === event.currentTarget) setCar(null); }}>
      {car.kind === "police" ? <PoliceCar /> : car.kind === "ambulance" ? <Ambulance /> : car.kind === "fire" ? <FireTruck /> : <svg viewBox="0 0 20 36" className="size-full drop-shadow-md">
        <rect x="1" y="1" width="18" height="34" rx="6" fill={car.color} stroke="rgb(15 23 42 / 0.35)" strokeWidth="1" />
        <rect x="3.5" y="7" width="13" height="7" rx="2" fill="rgb(255 255 255 / 0.75)" />
        <rect x="3.5" y="24" width="13" height="5" rx="2" fill="rgb(255 255 255 / 0.55)" />
        <rect x="3" y="1.8" width="4" height="2" rx="1" fill="#fef08a" />
        <rect x="13" y="1.8" width="4" height="2" rx="1" fill="#fef08a" />
      </svg>}
    </div>
  </div>;
}

// 上から見たパトカー。前と後ろが黒、屋根が白で、屋根の赤色灯は赤と青を交互に点滅させる。
function PoliceCar() {
  return <svg viewBox="0 0 20 36" className="size-full drop-shadow-md">
    <rect x="1" y="1" width="18" height="34" rx="6" fill="#111827" stroke="rgb(15 23 42 / 0.5)" strokeWidth="1" />
    <rect x="1.5" y="12" width="17" height="13" rx="1.5" fill="#ffffff" />
    <rect x="3.5" y="7" width="13" height="4.5" rx="2" fill="rgb(186 230 253 / 0.9)" />
    <rect x="3.5" y="25.5" width="13" height="4" rx="2" fill="rgb(186 230 253 / 0.7)" />
    <rect className="siren-light" x="3.5" y="16" width="6.5" height="3" rx="1" fill="#ef4444" />
    <rect className="siren-light siren-light-alt" x="10" y="16" width="6.5" height="3" rx="1" fill="#3b82f6" />
    <rect x="3" y="1.8" width="4" height="2" rx="1" fill="#fef08a" />
    <rect x="13" y="1.8" width="4" height="2" rx="1" fill="#fef08a" />
  </svg>;
}

// 上から見た救急車。白い車体の両脇に赤い線、屋根に赤十字。運転席の上の赤色灯を左右交互に点滅させる。
function Ambulance() {
  return <svg viewBox="0 0 20 36" className="size-full drop-shadow-md">
    <rect x="1" y="1" width="18" height="34" rx="4" fill="#ffffff" stroke="rgb(15 23 42 / 0.45)" strokeWidth="1" />
    <rect x="1.5" y="12" width="2" height="22" fill="#ef4444" />
    <rect x="16.5" y="12" width="2" height="22" fill="#ef4444" />
    <rect x="3.5" y="4.5" width="13" height="4" rx="1.5" fill="rgb(186 230 253 / 0.9)" />
    <rect className="siren-light" x="4" y="9.5" width="5.5" height="2.5" rx="1" fill="#ef4444" />
    <rect className="siren-light siren-light-alt" x="10.5" y="9.5" width="5.5" height="2.5" rx="1" fill="#ef4444" />
    <rect x="8.5" y="17" width="3" height="10" fill="#ef4444" />
    <rect x="5" y="20.5" width="10" height="3" fill="#ef4444" />
    <rect x="3" y="1.8" width="4" height="2" rx="1" fill="#fef08a" />
    <rect x="13" y="1.8" width="4" height="2" rx="1" fill="#fef08a" />
  </svg>;
}

// 上から見た消防車。ほかの車より長い赤い車体に、銀色のはしごを積む。運転席の上の赤色灯を左右交互に点滅させる。
function FireTruck() {
  return <svg viewBox="0 0 20 46" className="size-full drop-shadow-md">
    <rect x="1" y="1" width="18" height="44" rx="3" fill="#dc2626" stroke="rgb(15 23 42 / 0.45)" strokeWidth="1" />
    <rect x="3.5" y="3.5" width="13" height="4" rx="1.5" fill="rgb(186 230 253 / 0.9)" />
    <rect className="siren-light" x="4" y="8.5" width="5.5" height="2.5" rx="1" fill="#fca5a5" />
    <rect className="siren-light siren-light-alt" x="10.5" y="8.5" width="5.5" height="2.5" rx="1" fill="#fca5a5" />
    <rect x="1" y="12.5" width="18" height="1" fill="rgb(15 23 42 / 0.35)" />
    <rect x="5.5" y="15" width="1.5" height="28" fill="#e5e7eb" />
    <rect x="13" y="15" width="1.5" height="28" fill="#e5e7eb" />
    {[17, 21, 25, 29, 33, 37, 41].map((y) => <rect key={y} x="5.5" y={y} width="9" height="1" fill="#e5e7eb" />)}
    <rect x="3" y="1.8" width="4" height="2" rx="1" fill="#fef08a" />
    <rect x="13" y="1.8" width="4" height="2" rx="1" fill="#fef08a" />
  </svg>;
}
