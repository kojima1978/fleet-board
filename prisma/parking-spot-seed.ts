import type { PrismaClient } from "./generated/client";

// 新しく作る区画の初期の役割。作成後は設定画面から変更する。
export const defaultSpotRoles: Record<string, "TEMPORARY" | "CUSTOMER" | "HOLDING"> = {
  "08": "TEMPORARY", "13": "TEMPORARY", "17": "TEMPORARY", "18": "TEMPORARY",
  "01": "CUSTOMER", "02": "CUSTOMER", "20": "CUSTOMER", "24": "CUSTOMER",
  "22": "HOLDING", "23": "HOLDING",
};

export const parkingSpotGeometry = [
  ...[269.6, 360.6, 451.6, 542.6, 633.6, 724.6, 815.6].map((x, i) => ({ code: String(i + 1).padStart(2, "0"), x: x / 9.5, y: 385.334 / 5.25, width: 66.8 / 9.5, height: 110.8 / 5.25, orientation: "vertical" })),
  ...[269.6, 395.6, 521.6, 647.6, 771.6].map((x, i) => ({ code: String(i + 8).padStart(2, "0"), x: x / 9.5, y: 304.334 / 5.25, width: 110.8 / 9.5, height: 66.8 / 5.25, orientation: "horizontal" })),
  ...[269.6, 395.6, 521.6, 647.6].map((x, i) => ({ code: String(i + 13).padStart(2, "0"), x: x / 9.5, y: 222.334 / 5.25, width: 110.8 / 9.5, height: 66.8 / 5.25, orientation: "horizontal" })),
  ...[269.6, 393.6, 521.6].map((x, i) => ({ code: String(i + 17).padStart(2, "0"), x: x / 9.5, y: 141.334 / 5.25, width: 110.8 / 9.5, height: 66.8 / 5.25, orientation: "horizontal" })),
  ...["24", "26", "32"].map((code, i) => ({ code, x: 54.6 / 9.5, y: [220.334, 304.334, 429.334][i] / 5.25, width: 110.8 / 9.5, height: 66.8 / 5.25, orientation: "horizontal" })),
  ...["20", "21"].map((code, i) => ({ code, x: [269.6, 360.6][i] / 9.5, y: 16.6 / 5.25, width: 66.8 / 9.5, height: 110.8 / 5.25, orientation: "vertical" })),
  ...["23", "22"].map((code, i) => ({ code, x: 54.6 / 9.5, y: [16.6, 95.6][i] / 5.25, width: 110.8 / 9.5, height: 66.8 / 5.25, orientation: "horizontal" })),
] as const;

// 手前の区画の初期値（初期の区画番号で書く）。道路は配置図の左にあり、車は道路側から順に出し入れする。
// 既存DBには migrations/20261109100000_default_front_spots で同じ表を一度だけ入れている。変えるときは両方そろえる。
const toTwelve = ["08", "09", "10", "11", "12"];
export const defaultFrontSpotCodes: Record<string, readonly string[]> = {
  "18": ["17"], "19": ["17", "18"],
  "14": ["13"], "15": ["13", "14"], "16": ["13", "14", "15"],
  "09": ["08"], "10": ["08", "09"], "11": ["08", "09", "10"], "12": ["08", "09", "10", "11"],
  "20": ["17"], "21": ["17", "18"],
  "01": ["08"], "02": ["08", "09"], "03": ["08", "09"], "04": ["08", "09", "10"], "05": ["08", "09", "10", "11"], "06": toTwelve, "07": toTwelve,
};

// 区画番号を固定する前の番号（01〜26）。この番号のままのDBだけ、今の番号へ一度付け直す。
const legacySpotCodes = Array.from({ length: 26 }, (_, i) => String(i + 1).padStart(2, "0"));

// 起動時に配置図の区画をそろえる。区画は位置で見分け、設定画面で変えた区画番号と役割は上書きしない。
export async function syncParkingSpots(prisma: PrismaClient) {
  const existingSpots = await prisma.parkingSpot.findMany();
  const positionedSpots = parkingSpotGeometry.map((geometry) => ({
    geometry,
    spot: existingSpots.find((spot) => Math.abs(spot.x - geometry.x) < 0.01 && Math.abs(spot.y - geometry.y) < 0.01),
  }));
  const codes = existingSpots.map((spot) => spot.code).sort();
  const legacy = positionedSpots.every(({ spot }) => spot) && codes.length === legacySpotCodes.length && codes.every((code, i) => code === legacySpotCodes[i]);
  if (legacy) {
    await prisma.$transaction(async (tx) => {
      // 一度仮番号へ退避し、24・26などの入れ替えでも一意制約に抵触させない。
      for (const [index, { spot }] of positionedSpots.entries()) {
        await tx.parkingSpot.update({ where: { id: spot!.id }, data: { code: `__renumber_${index + 1}` } });
      }
      for (const { geometry, spot } of positionedSpots) {
        await tx.parkingSpot.update({ where: { id: spot!.id }, data: geometry });
      }
    });
    return;
  }
  const usedCodes = new Set(codes);
  const created = new Map<string, string>();
  for (const { geometry, spot } of positionedSpots) {
    // その位置に区画がない場合だけ作る。初期の番号が別の区画で使われていたら作らない。
    if (spot || usedCodes.has(geometry.code)) continue;
    const createdSpot = await prisma.parkingSpot.create({ data: { ...geometry, role: defaultSpotRoles[geometry.code] ?? "REGULAR" } });
    created.set(geometry.code, createdSpot.id);
    usedCodes.add(geometry.code);
  }
  if (!created.size) return;
  // 新しく作った区画にだけ手前の区画の初期値を入れる。手前の区画は位置で探す。
  const spots = await prisma.parkingSpot.findMany({ select: { id: true, x: true, y: true } });
  const idOf = (code: string) => {
    const geometry = parkingSpotGeometry.find((item) => item.code === code)!;
    return spots.find((spot) => Math.abs(spot.x - geometry.x) < 0.01 && Math.abs(spot.y - geometry.y) < 0.01)?.id;
  };
  for (const [code, id] of created) {
    const frontSpotIds = (defaultFrontSpotCodes[code] ?? []).map(idOf).filter((item): item is string => !!item);
    if (frontSpotIds.length) await prisma.parkingSpot.update({ where: { id }, data: { frontSpotIds } });
  }
}
