import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

const spotGeometry = [
  ...Array.from({ length: 7 }, (_, i) => ({ code: String(i + 1).padStart(2, "0"), x: 14 + i * 11.5, y: 73.3333, width: 10, height: 21.3333, orientation: "vertical" })),
  ...Array.from({ length: 4 }, (_, i) => ({ code: String(i + 8).padStart(2, "0"), x: 23 + i * 18.5, y: 52.6667, width: 16.5, height: 13.3333, orientation: "horizontal" })),
  ...Array.from({ length: 3 }, (_, i) => ({ code: String(i + 12).padStart(2, "0"), x: 23 + i * 18.5, y: 36.6667, width: 16.5, height: 13.3333, orientation: "horizontal" })),
  { code: "15", x: 41.5, y: 20.6667, width: 16.5, height: 13.3333, orientation: "horizontal" },
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
];

async function main() {
  for (const s of spotGeometry) await prisma.parkingSpot.upsert({ where: { code: s.code }, update: s, create: s });
  for (const [code, name, department] of people) await prisma.employee.upsert({
    where: { code }, update: { name, department }, create: { code, name, department, nfcUid: `NFC-${code}` },
  });
  const spots = await prisma.parkingSpot.findMany({ orderBy: { code: "asc" } });
  for (let i = 0; i < cars.length; i++) {
    const [code, name, plateNumber, color] = cars[i];
    await prisma.vehicle.upsert({
      where: { code },
      update: { name, plateNumber, color },
      create: { code, name, plateNumber, color, nfcUid: `NFC-${code}`, parkingSpotId: spots[i]?.id },
    });
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
