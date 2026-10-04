import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";
import { parkingSpotGeometry } from "./parking-spot-seed";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  const existingSpots = await prisma.parkingSpot.findMany();
  const positionedSpots = parkingSpotGeometry.map((geometry) => ({
    geometry,
    spot: existingSpots.find((spot) => Math.abs(spot.x - geometry.x) < 0.01 && Math.abs(spot.y - geometry.y) < 0.01),
  }));

  if (positionedSpots.every(({ spot }) => spot)) {
    await prisma.$transaction(async (tx) => {
      // 一度仮番号へ退避し、24・26などの入れ替えでも一意制約に抵触させない。
      for (const [index, { spot }] of positionedSpots.entries()) {
        await tx.parkingSpot.update({ where: { id: spot!.id }, data: { code: `__renumber_${index + 1}` } });
      }
      for (const { geometry, spot } of positionedSpots) {
        await tx.parkingSpot.update({ where: { id: spot!.id }, data: geometry });
      }
    });
  } else {
    for (const geometry of parkingSpotGeometry) {
      await prisma.parkingSpot.upsert({
        where: { code: geometry.code },
        update: geometry,
        create: geometry,
      });
    }
  }
  console.log(`Production parking spots initialized: ${parkingSpotGeometry.length}`);
}

main().finally(() => prisma.$disconnect());
