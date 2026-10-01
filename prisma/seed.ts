import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

const spotGeometry = [
  ...[251.6, 350.8, 450, 549.2, 648.4, 747.6, 846.8].map((x, i) => ({ code: String(i + 1).padStart(2, "0"), x: x / 9.5, y: 371 / 5.25, width: 72.8 / 9.5, height: 120.8 / 5.25, orientation: "vertical" })),
  ...[251.6, 389.2, 526.8, 664.4, 798.8].map((x, i) => ({ code: String(i + 8).padStart(2, "0"), x: x / 9.5, y: 282.2 / 5.25, width: 120.8 / 9.5, height: 72.8 / 5.25, orientation: "horizontal" })),
  ...[251.6, 389.2, 526.8, 664.4].map((x, i) => ({ code: String(i + 13).padStart(2, "0"), x: x / 9.5, y: 193.4 / 5.25, width: 120.8 / 9.5, height: 72.8 / 5.25, orientation: "horizontal" })),
  ...[251.6, 386.6, 526.8].map((x, i) => ({ code: String(i + 17).padStart(2, "0"), x: x / 9.5, y: 104.6 / 5.25, width: 120.8 / 9.5, height: 72.8 / 5.25, orientation: "horizontal" })),
  ...[190.6, 282.6, 374.6].map((y, i) => ({ code: String(i + 20).padStart(2, "0"), x: 16.6 / 9.5, y: y / 5.25, width: 120.8 / 9.5, height: 72.8 / 5.25, orientation: "horizontal" })),
];

const people = [
  ["E001", "佐藤 美咲", "営業部"], ["E002", "田中 健太", "総務部"], ["E003", "鈴木 翔", "技術部"],
  ["E004", "高橋 愛", "営業部"], ["E005", "伊藤 誠", "管理部"], ["E006", "渡辺 結衣", "企画部"],
];

const cars = [
  ["C01", "アクア 1", "品川 300 あ 12-34", "#2563eb"], ["C02", "アクア 2", "品川 300 あ 56-78", "#0891b2"],
  ["C03", "プリウス", "品川 330 い 88-01", "#7c3aed"], ["C04", "ノート", "品川 500 う 22-45", "#ea580c"],
  ["C05", "ハイエース", "品川 400 え 90-12", "#475569"], ["C06", "フリード", "品川 500 お 31-67", "#16a34a"],
  ["C07", "サクラ", "品川 580 か 10-08", "#db2777"], ["C08", "プロボックス", "品川 400 き 73-19", "#ca8a04"],
  ["C09", "シエンタ", "品川 500 く 24-68", "#0f766e"], ["C10", "フィット", "品川 500 け 35-79", "#9333ea"],
  ["C11", "タウンエース", "品川 400 こ 46-80", "#0369a1"], ["C12", "キャラバン", "品川 400 さ 57-91", "#b45309"],
  ["C13", "N-BOX", "品川 580 し 68-02", "#be123c"],
  ["C14", "ヴォクシー", "品川 500 す 79-13", "#1d4ed8"], ["C15", "ヤリス", "品川 500 せ 80-24", "#059669"],
  ["C16", "エブリイ", "品川 400 そ 91-35", "#64748b"], ["C17", "ルーミー", "品川 500 た 02-46", "#c026d3"],
];

async function main() {
  const existingSpots = await prisma.parkingSpot.findMany();
  const positionedSpots = spotGeometry.map((geometry) => ({ geometry, spot: existingSpots.find((spot) => Math.abs(spot.x - geometry.x) < 0.01 && Math.abs(spot.y - geometry.y) < 0.01) }));
  if (positionedSpots.every(({ spot }) => spot)) {
    await prisma.$transaction(async (tx) => {
      for (const [index, { spot }] of positionedSpots.entries()) await tx.parkingSpot.update({ where: { id: spot!.id }, data: { code: `__renumber_${index + 1}` } });
      for (const { geometry, spot } of positionedSpots) await tx.parkingSpot.update({ where: { id: spot!.id }, data: geometry });
    });
  } else {
    for (const geometry of spotGeometry) await prisma.parkingSpot.upsert({ where: { code: geometry.code }, update: geometry, create: geometry });
  }
  for (const [code, name, department] of people) await prisma.employee.upsert({
    where: { code }, update: { name, department }, create: { code, name, department, nfcUid: `NFC-${code}` },
  });
  const spots = await prisma.parkingSpot.findMany({ orderBy: { code: "asc" } });
  const existingVehicles = await prisma.vehicle.findMany({ select: { code: true, parkingSpotId: true } });
  const existingByCode = new Map(existingVehicles.map((vehicle) => [vehicle.code, vehicle]));
  const occupiedSpotIds = new Set(existingVehicles.flatMap((vehicle) => vehicle.parkingSpotId ? [vehicle.parkingSpotId] : []));
  const nonRegularCodes = new Set(["01", "02", "08", "13", "17", "18"]);
  for (let i = 0; i < cars.length; i++) {
    const [code, name, plateNumber, color] = cars[i];
    const existingVehicle = existingByCode.get(code);
    const freeSpot = existingVehicle ? undefined : spots.find((spot) => !occupiedSpotIds.has(spot.id) && !nonRegularCodes.has(spot.code)) ?? spots.find((spot) => !occupiedSpotIds.has(spot.id));
    await prisma.vehicle.upsert({
      where: { code },
      update: { name, plateNumber, color },
      create: { code, name, plateNumber, color, nfcUid: `NFC-${code}`, parkingSpotId: freeSpot?.id },
    });
    if (freeSpot) occupiedSpotIds.add(freeSpot.id);
  }
  const employees = await prisma.employee.findMany({ orderBy: { code: "asc" } });
  const vehicles = await prisma.vehicle.findMany({ orderBy: { code: "asc" } });
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const at = (hours: number, minutes = 0) => new Date(`${day}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00+09:00`);
  const samples = [
    { id: "sample-trip-01", employeeId: employees[0].id, vehicleId: vehicles[0].id, plannedStart: at(9), plannedEnd: at(10, 30), actualStart: at(9, 4), actualEnd: at(10, 18), status: "COMPLETED" as const, purpose: "取引先訪問", returnSpotCode: "01" },
    { id: "sample-trip-02", employeeId: employees[2].id, vehicleId: vehicles[2].id, plannedStart: at(10), plannedEnd: at(12), actualStart: null, actualEnd: null, status: "RESERVED" as const, purpose: "現場確認", returnSpotCode: null },
    { id: "sample-trip-03", employeeId: employees[3].id, vehicleId: vehicles[3].id, plannedStart: at(13), plannedEnd: at(14, 30), actualStart: null, actualEnd: null, status: "RESERVED" as const, purpose: "顧客訪問", returnSpotCode: null },
    { id: "sample-trip-04", employeeId: employees[1].id, vehicleId: vehicles[5].id, plannedStart: at(15), plannedEnd: at(16), actualStart: null, actualEnd: null, status: "RESERVED" as const, purpose: "備品購入", returnSpotCode: null },
  ];
  for (const sample of samples) {
    await prisma.trip.upsert({ where: { id: sample.id }, update: sample, create: sample });
  }
}

main().finally(() => prisma.$disconnect());
