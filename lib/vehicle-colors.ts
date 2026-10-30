import type { CSSProperties } from "react";

// 車両の表示色は実車の色に合わせて選ぶ。一覧にない色は「その他」で自由に指定できる。
export const VEHICLE_COLORS = [
  { name: "ホワイト", value: "#F8FAFC" },
  { name: "シルバー", value: "#C0C6CF" },
  { name: "グレー", value: "#6B7280" },
  { name: "ブラック", value: "#1F2937" },
  { name: "ネイビー", value: "#1E3A8A" },
  { name: "ブルー", value: "#2563EB" },
  { name: "レッド", value: "#DC2626" },
  { name: "オレンジ", value: "#EA580C" },
  { name: "イエロー", value: "#EAB308" },
  { name: "グリーン", value: "#15803D" },
  { name: "ブラウン", value: "#92400E" },
  { name: "ベージュ", value: "#D6C7A1" },
] as const;

export function vehicleColorName(color: string) {
  return VEHICLE_COLORS.find((item) => item.value.toLowerCase() === color.toLowerCase())?.name ?? null;
}

// 白・シルバー・ベージュ・イエローなど明るい色は白い背景に溶けるため、縁取りを付けて見えるようにする。
export function isLightVehicleColor(color: string) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!match) return false;
  const [r, g, b] = match.slice(1).map((hex) => {
    const channel = parseInt(hex, 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45;
}

const LIGHT_OUTLINE = "drop-shadow(0 0 0.5px rgb(15 23 42 / 0.9)) drop-shadow(0 0 0.5px rgb(15 23 42 / 0.9))";

export function vehicleIconStyle(color: string): CSSProperties {
  return isLightVehicleColor(color) ? { color, filter: LIGHT_OUTLINE } : { color };
}

export function vehicleDotStyle(color: string): CSSProperties {
  return isLightVehicleColor(color) ? { background: color, boxShadow: "inset 0 0 0 1px rgb(100 116 139)" } : { background: color };
}
